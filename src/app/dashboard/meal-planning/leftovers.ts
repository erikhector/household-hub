// Pure helpers for GAP-8's leftover tracking on "mark meal as cooked" —
// split out from cooking-actions.ts (a "use server" file, which may only
// export async functions) so the naming, validation and expiry rules are
// unit-testable without mocking Prisma, same as cooked-ingredients.ts. The
// actual find-or-create/merge write stays in markMealEntryCookedAction's
// transaction.

import { z } from "zod";
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// Leftovers get a flat ~3-day estimate — the conservative end of the usual
// "3–4 days in the fridge" guidance for cooked food, and the same number
// shelf-life.ts's SHELF_LIFE_CATEGORY_DEFAULTS already uses for meat (the
// most perishable category it estimates). Written onto a newly-created
// leftovers item as its own `shelfLifeDays` override too, since its
// "Leftovers" category never maps to one of the estimator's category
// defaults — any later stock-arrival path (AUTO-7) then re-estimates with
// the same 3 days rather than skipping it.
export const LEFTOVERS_SHELF_LIFE_DAYS = 3;

// A generous sanity cap, not a real-world limit — nobody puts 100+ servings
// of one dish in the fridge, and it keeps a typo ("40" for "4" is plausible,
// "4000" isn't) from creating a nonsense inventory row.
export const MAX_LEFTOVER_SERVINGS = 100;

// Mirrors the inventory item form's own name bound (itemSchema in
// src/app/dashboard/inventory/actions.ts), so a leftovers row created here
// is always editable there without first failing its validation.
const MAX_ITEM_NAME_LENGTH = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

// Empty (the default — the field starts blank) means "no leftovers", same
// as 0: the Guardrails' "suggest, don't silently mutate" rule means a
// leftovers row is only ever created when the household typed a number.
// Whole servings only — "half a serving left" isn't worth tracking, and an
// integer keeps the merge-by-adding arithmetic exact.
export const leftoverServingsSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? 0 : value),
  z.coerce.number().int().min(0).max(MAX_LEFTOVER_SERVINGS),
);

/**
 * The inventory item name a recipe's leftovers are filed under, e.g.
 * "Leftovers: Lasagna" — `prefix` is the household's locale's
 * `mealPlanning.leftoversNamePrefix`. This exact name (case-insensitively)
 * is also the identity a second batch of the same dish merges into.
 * Truncates the recipe name rather than the prefix so the result still
 * reads as leftovers when a very long recipe name would overflow the
 * inventory name limit.
 */
export function leftoversItemName(prefix: string, recipeName: string): string {
  const head = `${prefix}: `;
  const room = Math.max(0, MAX_ITEM_NAME_LENGTH - head.length);
  return `${head}${recipeName.trim().slice(0, room)}`.trim();
}

export type LeftoversExpiryInput = {
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
  shelfLifeDays: number | null;
};

/**
 * The expiry patch for a leftovers item receiving a fresh batch — `{
 * expiresAt, expiresAtEstimated: true }`, or null when its expiry must be
 * left alone. The freshest batch resets the estimate (rather than keeping
 * the older batch's earlier date): one merged row can only carry one date,
 * and the point of the badge is that the dish shows up as "expiring soon"
 * before the *new* food is forgotten — the older portion is nearly always
 * eaten first anyway. Two cases are deliberately left alone, matching
 * AUTO-7's shared rule in shelf-life.ts: a real, user-typed date
 * (`expiresAtEstimated: false`) always sticks, and `shelfLifeDays: -1`
 * ("never expires") is a household's explicit opt-out. A positive
 * `shelfLifeDays` override the household set on the item wins over the
 * 3-day default.
 */
export function leftoversExpiryUpdate(
  current: LeftoversExpiryInput,
  now: Date = new Date(),
): { expiresAt: Date; expiresAtEstimated: true } | null {
  if (current.expiresAt && !current.expiresAtEstimated) return null;
  const days = current.shelfLifeDays ?? LEFTOVERS_SHELF_LIFE_DAYS;
  if (days < 0) return null;
  return { expiresAt: new Date(now.getTime() + days * DAY_MS), expiresAtEstimated: true };
}

// What markMealEntryCookedAction changed for leftovers, handed back to
// MarkCookedDialog so the toast's Undo can reverse it exactly — delete a
// row it created, or restore a merged row's previous quantity/expiry.
// Dates travel as ISO strings since this crosses the Server Action
// boundary twice (out to the client, then back into the undo action).
export type LeftoversChange =
  | { itemId: string; created: true }
  | {
      itemId: string;
      created: false;
      previousQuantity: number;
      previousExpiresAt: string | null;
      previousExpiresAtEstimated: boolean;
    };

// Validates the change the client echoes back into
// undoMarkMealEntryCookedAction. It's still re-scoped to the caller's
// household on write, so the worst a tampered payload can do is set a
// quantity/expiry on the household's own item — which the inventory page
// already lets any member do directly.
export const leftoversChangeSchema = z.union([
  z.object({ itemId: z.string().min(1), created: z.literal(true) }),
  z.object({
    itemId: z.string().min(1),
    created: z.literal(false),
    previousQuantity: z.number().finite().min(0).max(1_000_000),
    previousExpiresAt: z.iso.datetime().nullable(),
    previousExpiresAtEstimated: z.boolean(),
  }),
]);

// GAP-39: how far past the cook date the "Plan leftovers" prompt looks for a
// dinner-free day. Two months is far beyond any real plan; it only bounds
// the query suggestLeftoversDayAction runs.
export const LEFTOVERS_DAY_SEARCH_DAYS = 60;

/**
 * The first day after `afterKey` (yyyy-mm-dd) that isn't in `dinnerDateKeys`
 * — the day "Plan leftovers" prefills. Strictly after, since leftovers are
 * eaten on a later day than the cook. It only ever suggests: the dialog
 * lets the household change the day, and nothing is written until they
 * confirm. If every day in the search window already has a dinner it
 * returns the day just past the window (which the caller never queried, so
 * it's unchecked but harmless: adding a meal never replaces another).
 */
export function nextFreeDinnerDay(afterKey: string, dinnerDateKeys: Iterable<string>): string {
  const taken = new Set(dinnerDateKeys);
  const start = parseDateKey(afterKey);
  for (let offset = 1; offset <= LEFTOVERS_DAY_SEARCH_DAYS; offset++) {
    const key = toDateKey(addDays(start, offset));
    if (!taken.has(key)) return key;
  }
  return toDateKey(addDays(start, LEFTOVERS_DAY_SEARCH_DAYS + 1));
}
