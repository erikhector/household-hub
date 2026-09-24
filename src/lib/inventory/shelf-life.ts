// AUTO-7 — estimates an expiry date from an item's shelf life when stock
// arrives, so items stop sitting with no `expiresAt` at all just because
// nobody used the single-item form's date picker (see that form,
// ItemFormDialog, and REQUIREMENTS.md's "Expiry/best-before tracking").
// Pure and dependency-light like auto-category.ts, so every stock-arrival
// action (togglePurchasedAction, applyReceiptScanAction/registerReceiptAction,
// bulkCreateInventoryItemsAction) can share the exact same decision of
// whether to write an estimate, without duplicating the "never clobber a
// real date" rule in each one.

import { AUTO_CATEGORY_KEYS, type AutoCategoryKey } from "@/lib/inventory/auto-category";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

const DAY_MS = 24 * 60 * 60 * 1000;

// Grocy's own "default best before days" starting point, trimmed to the
// categories where a default is actually useful — a fridge/freezer or
// pantry/household item's real shelf life varies far too much by product to
// guess responsibly (a can of beans and a bag of chips are both "pantry"),
// so those keys are left out on purpose and never get an estimate unless the
// item has its own `shelfLifeDays` override.
export const SHELF_LIFE_CATEGORY_DEFAULTS: Partial<Record<AutoCategoryKey, number>> = {
  produce: 5,
  bakery: 4,
  dairy: 7,
  meat: 3,
};

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

// Built once from both locales' `inventory.autoCategories` labels (the same
// strings a new item's `category` column actually stores — see
// resolveAutoCategory in auto-category.ts), so a household on either
// language, or one with a mix of items filed under each, resolves the same
// default. A category the user typed themselves (never matching either
// label set) simply has no default, same as "Uncategorized".
const CATEGORY_LABEL_TO_KEY = new Map<string, AutoCategoryKey>();
for (const labels of [en.inventory.autoCategories, sv.inventory.autoCategories]) {
  for (const key of AUTO_CATEGORY_KEYS) {
    CATEGORY_LABEL_TO_KEY.set(normalizeLabel(labels[key]), key);
  }
}

/**
 * The category default shelf life (in days), or null when the category
 * doesn't map to one of AUTO_CATEGORY_KEYS or has no default of its own
 * (frozen/pantry/drinks/cleaning/bathroom).
 */
export function defaultShelfLifeDaysForCategory(category: string): number | null {
  const key = CATEGORY_LABEL_TO_KEY.get(normalizeLabel(category));
  if (!key) return null;
  return SHELF_LIFE_CATEGORY_DEFAULTS[key] ?? null;
}

/**
 * Resolves the shelf life to actually use: an item's own `shelfLifeDays`
 * (set on the item form, either a positive override or -1 for "never
 * expires") always wins over the category default. Returns null when
 * neither is known — the estimator then leaves `expiresAt` alone.
 */
export function resolveShelfLifeDays(shelfLifeDays: number | null, category: string): number | null {
  if (shelfLifeDays != null) return shelfLifeDays;
  return defaultShelfLifeDaysForCategory(category);
}

/**
 * The estimated expiry date for a newly-stocked item, or null when there's
 * nothing to estimate — no shelf life known either way, or the item is
 * marked -1 ("never expires").
 */
export function estimateExpiryDate(
  shelfLifeDays: number | null,
  category: string,
  from: Date = new Date(),
): Date | null {
  const days = resolveShelfLifeDays(shelfLifeDays, category);
  if (days == null || days < 0) return null;
  return new Date(from.getTime() + days * DAY_MS);
}

export type ExpiryEstimationInput = {
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
  shelfLifeDays: number | null;
  category: string;
};

/**
 * Whether a stock-arrival event should (re)write an estimated expiry —
 * the Guardrails-driven gate shared by every arrival path. Per the AUTO-7
 * design brief: only when stock crosses from 0 into positive, or the item
 * has no expiry at all yet; and never when the current `expiresAt` is a
 * real, user-entered date (`expiresAtEstimated: false`) — a correction (or
 * a manual entry) always sticks, the estimator never re-guesses over it.
 */
export function shouldEstimateExpiry(
  current: Pick<ExpiryEstimationInput, "expiresAt" | "expiresAtEstimated">,
  previousQuantity: number,
  nextQuantity: number,
): boolean {
  if (current.expiresAt && !current.expiresAtEstimated) return false;
  if (previousQuantity <= 0 && nextQuantity > 0) return true;
  return current.expiresAt === null;
}

/**
 * The Prisma update patch a stock-arrival action should merge into its
 * write — `{ expiresAt, expiresAtEstimated: true }` when an estimate should
 * be (re)written, or null when nothing about the item's expiry should
 * change (already real, already estimated and not newly arriving, or no
 * shelf life known for its category). Callers spread the result (`{
 * ...patch }`, a no-op when null) straight into their existing update/create
 * data rather than branching on it themselves.
 */
export function estimatedExpiryUpdate(
  current: ExpiryEstimationInput,
  previousQuantity: number,
  nextQuantity: number,
  now: Date = new Date(),
): { expiresAt: Date; expiresAtEstimated: true } | null {
  if (!shouldEstimateExpiry(current, previousQuantity, nextQuantity)) return null;
  const expiresAt = estimateExpiryDate(current.shelfLifeDays, current.category, now);
  if (!expiresAt) return null;
  return { expiresAt, expiresAtEstimated: true };
}
