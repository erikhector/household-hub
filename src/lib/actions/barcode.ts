"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { isValidBarcodeFormat, normalizeBarcode } from "@/lib/barcode";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { categoryKeyFromOpenFoodFactsTags } from "@/lib/inventory/auto-category";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";
import { releaseBarcode } from "@/lib/inventory/barcode-link";
import { recordOutOfStockTransition } from "@/lib/notifications";
import { addToDefaultListOnLowStock, revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";
import { toFriendlyError } from "@/lib/actions/errors";

// Two halves live here:
//
// - lookupBarcodeAction: shared by the inventory add-item form, the scan
//   queue and the shopping list's advanced add form (see
//   src/components/shared/barcode-scanner.tsx) — a best-effort product name
//   (and, for AUTO-2, a category to pre-fill) for a scanned barcode, nothing
//   household-scoped. requireHousehold() is still called first, matching
//   every other action in this app's "never a reachable, unauthenticated
//   Server Action" convention, even though the household id itself isn't
//   used for anything there.
// - The remembered-barcode actions (AUTO-6) below it: a code the household
//   has linked to one of its items (InventoryItem.barcode) resolves to that
//   item, household-scoped, *before* Open Food Facts is ever asked — so a
//   known product's digits never leave the server at all, and only an
//   unknown one's are sent for a name.

const OPEN_FOOD_FACTS_TIMEOUT_MS = 5000;

export type BarcodeLookupResult = {
  name: string | null;
  /** The product's category from Open Food Facts, mapped to one of the
   * canonical auto-categories (AUTO-2) and labelled in the user's locale —
   * null when there's no product or its tags didn't map to anything. */
  category?: string | null;
};

type OpenFoodFactsResponse = {
  status?: number;
  product?: {
    product_name?: unknown;
    categories_tags?: unknown;
  };
};

export async function lookupBarcodeAction(barcode: string): Promise<BarcodeLookupResult> {
  await requireHousehold();
  return fetchOpenFoodFactsProduct(barcode);
}

// Not exported: a "use server" file's exports are all reachable Server
// Actions, and this one skips the session check its callers have already
// done.
async function fetchOpenFoodFactsProduct(barcode: string): Promise<BarcodeLookupResult> {
  const trimmed = barcode.trim();
  if (!isValidBarcodeFormat(trimmed)) {
    return { name: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPEN_FOOD_FACTS_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(trimmed)}.json`,
      {
        signal: controller.signal,
        // Open Food Facts asks API consumers to identify themselves.
        headers: { "User-Agent": "HouseholdHub - Barcode Scanner Feature" },
      },
    );
    if (!response.ok) return { name: null };

    const data = (await response.json()) as OpenFoodFactsResponse;
    if (data.status !== 1 || !data.product) return { name: null };

    const rawName = data.product.product_name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length === 0) return { name: null };

    const tags = Array.isArray(data.product.categories_tags)
      ? data.product.categories_tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const categoryKey = categoryKeyFromOpenFoodFactsTags(tags);
    const category = categoryKey ? (await getDictionary()).inventory.autoCategories[categoryKey] : null;
    return { name, category };
  } catch {
    // Network error, timeout, malformed JSON, etc. — the caller falls back
    // to manual entry either way, so no error needs to surface here.
    return { name: null };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Remembered barcodes (AUTO-6)
// ---------------------------------------------------------------------------

/** The item a scan touched, and where its stock ended up. */
export type ScannedItem = { id: string; name: string; unit: string; quantity: number };

export type StockScanResult =
  /** A known code: the change is already saved. `appliedDelta` is what the
   * quantity actually moved by after flooring at zero (a "Used up" scan of
   * an item already at 0 applies 0) — exactly what Undo has to reverse. */
  | { kind: "applied"; item: ScannedItem; appliedDelta: number }
  /** No item in this household has the code yet — Open Food Facts' best
   * guess at a name/category, for "Add as new item" or "This is…". */
  | { kind: "unknown"; barcode: string; name: string | null; category: string | null }
  | { kind: "error"; error: string };

// A scan is ±1 in practice; the bound just keeps a crafted call from
// writing an absurd quantity.
const deltaSchema = z.number().finite().min(-1000).max(1000);

const REVALIDATE_PATHS = ["/dashboard/inventory", "/dashboard"];

function revalidateInventory() {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
}

function toScannedItem(item: { id: string; name: string; unit: string }, quantity: number): ScannedItem {
  return { id: item.id, name: item.name, unit: item.unit, quantity };
}

/**
 * The inventory "Scan" dialog's one call per scan: resolves `barcode` to
 * this household's item and changes its stock by `delta` straight away (+1
 * "Put away", −1 "Used up"). That's an explicit user action — they chose
 * the mode and pointed the camera — so per the Guardrails it's applied
 * immediately with Undo (undoScanStockChangeAction) rather than confirmed.
 * Same clamping and out-of-stock side effect as adjustQuantityAction's +/-
 * taps, so a scan and a tap can't disagree.
 */
export async function scanStockChangeAction(barcode: string, delta: number): Promise<StockScanResult> {
  const { household, userId } = await requireHousehold();

  const code = normalizeBarcode(barcode);
  if (!code) return { kind: "error", error: "Invalid barcode" };
  const parsedDelta = deltaSchema.safeParse(delta);
  if (!parsedDelta.success || parsedDelta.data === 0) return { kind: "error", error: "Invalid change" };

  const item = await prisma.inventoryItem.findFirst({ where: { householdId: household.id, barcode: code } });
  if (!item) {
    const lookup = await fetchOpenFoodFactsProduct(code);
    return { kind: "unknown", barcode: code, name: lookup.name, category: lookup.category ?? null };
  }

  const nextQuantity = nextQuantityAfterDelta(item.quantity, parsedDelta.data);
  // AUTO-8: a scan that drops an item into low stock puts it on "Next
  // shop" like any other decrease. No toast/Undo in the scan dialog —
  // the row is flagged addedAutomatically on the list.
  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId);
    autoAdded = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, nextQuantity);
  } catch (error) {
    return { kind: "error", error: (await toFriendlyError(error)).error ?? "Something went wrong" };
  }

  revalidateInventory();
  revalidateAutoAdded([autoAdded]);
  return {
    kind: "applied",
    item: toScannedItem(item, nextQuantity),
    appliedDelta: Math.round((nextQuantity - item.quantity) * 100) / 100,
  };
}

/**
 * Reverses one scan's stock change by the `appliedDelta` it reported —
 * never the barcode link or a newly created item, which were separate,
 * explicit choices (a wrong link is fixed by linking again). Applied as a
 * relative change rather than restoring the old absolute quantity, so an
 * Undo tapped after someone else's +/- (or a later scan of the same item)
 * doesn't wipe that out too. The client drops the Undo button once used, so
 * one scan can't be reversed twice from the same dialog.
 */
export async function undoScanStockChangeAction(
  itemId: string,
  appliedDelta: number,
): Promise<{ error?: string; item?: ScannedItem }> {
  const { household, userId } = await requireHousehold();

  const parsedDelta = deltaSchema.safeParse(appliedDelta);
  if (!parsedDelta.success) return { error: "Invalid change" };

  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, householdId: household.id } });
  if (!item) return { error: "Item not found" };
  if (parsedDelta.data === 0) return { item: toScannedItem(item, item.quantity) };

  const nextQuantity = nextQuantityAfterDelta(item.quantity, -parsedDelta.data);
  // AUTO-8 low-stock auto-add — see scanStockChangeAction.
  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId);
    autoAdded = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, nextQuantity);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateInventory();
  revalidateAutoAdded([autoAdded]);
  return { item: toScannedItem(item, nextQuantity) };
}

/**
 * "This is…": links an unknown `barcode` to one of the household's existing
 * items and applies the scan's `delta` to it in the same step — the user
 * scanned in a mode, so the stock change they meant happens too, with the
 * same Undo as a known scan. If another item already holds the code it
 * moves here (releaseBarcode): the latest explicit link is the correction
 * that sticks.
 */
export async function linkBarcodeAction(
  barcode: string,
  itemId: string,
  delta: number,
): Promise<StockScanResult> {
  const { household, userId } = await requireHousehold();

  const code = normalizeBarcode(barcode);
  if (!code) return { kind: "error", error: "Invalid barcode" };
  const parsedDelta = deltaSchema.safeParse(delta);
  if (!parsedDelta.success) return { kind: "error", error: "Invalid change" };

  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, householdId: household.id } });
  if (!item) return { kind: "error", error: "Item not found" };

  const nextQuantity = nextQuantityAfterDelta(item.quantity, parsedDelta.data);
  // AUTO-8 low-stock auto-add — see scanStockChangeAction.
  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await releaseBarcode(tx, household.id, code, item.id);
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { barcode: code, quantity: nextQuantity, updatedByUserId: userId },
      });
      await recordOutOfStockTransition(tx, household.id, item.id, item.quantity, nextQuantity, userId);
      autoAdded = await addToDefaultListOnLowStock(tx, household.id, item.id, item.quantity, nextQuantity);
    });
  } catch (error) {
    return { kind: "error", error: (await toFriendlyError(error)).error ?? "Something went wrong" };
  }

  revalidateInventory();
  revalidateAutoAdded([autoAdded]);
  return {
    kind: "applied",
    item: toScannedItem(item, nextQuantity),
    appliedDelta: Math.round((nextQuantity - item.quantity) * 100) / 100,
  };
}

const newItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  category: z.string().trim().max(60).optional(),
});

/**
 * "Add as new item": creates the item an unknown code belongs to, with the
 * code remembered on it and the scan's `delta` as its starting stock (1 for
 * "Put away", 0 for "Used up" — you've just finished the only one). The
 * name is Open Food Facts' suggestion as edited by the user; the category
 * is Open Food Facts' (AUTO-2) when it had one, else the same household-
 * memory/dictionary guess every other create path uses.
 */
export async function createItemFromBarcodeAction(input: {
  barcode: string;
  name: string;
  category?: string | null;
  delta: number;
}): Promise<StockScanResult> {
  const { household, userId } = await requireHousehold();

  const code = normalizeBarcode(input.barcode);
  if (!code) return { kind: "error", error: "Invalid barcode" };
  const parsedDelta = deltaSchema.safeParse(input.delta);
  if (!parsedDelta.success) return { kind: "error", error: "Invalid change" };
  const parsed = newItemSchema.safeParse({ name: input.name, category: input.category ?? undefined });
  if (!parsed.success) return { kind: "error", error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const quantity = nextQuantityAfterDelta(0, parsedDelta.data);
  let created: { id: string; name: string; unit: string };
  try {
    const guessed = parsed.data.category || (await createCategoryResolver(household.id)(parsed.data.name));
    const category = guessed || (await getDictionary()).inventory.uncategorized;
    created = await prisma.$transaction(async (tx) => {
      await releaseBarcode(tx, household.id, code);
      return tx.inventoryItem.create({
        data: {
          householdId: household.id,
          name: parsed.data.name,
          category,
          quantity,
          unit: "pcs",
          lowStockThreshold: 1,
          barcode: code,
          updatedByUserId: userId,
        },
      });
    });
    if (!guessed) scheduleAiCategoryFallback(household.id, [parsed.data.name]);
  } catch (error) {
    return { kind: "error", error: (await toFriendlyError(error)).error ?? "Something went wrong" };
  }

  revalidateInventory();
  return { kind: "applied", item: toScannedItem(created, quantity), appliedDelta: quantity };
}

export type BarcodeItemLookup =
  | { kind: "known"; item: { id: string; name: string; unit: string } }
  | { kind: "unknown"; barcode: string; name: string | null; category: string | null }
  | { kind: "error"; error: string };

/**
 * Read-only resolve for the shopping list's smart add line: a known code
 * comes back as its item, so the list can add it in one scan (through the
 * same smartAddShoppingListItemsAction as a typed name, for its dedupe and
 * price defaults); an unknown one falls back to Open Food Facts' name for
 * the user to confirm or type over.
 */
export async function findItemByBarcodeAction(barcode: string): Promise<BarcodeItemLookup> {
  const { household } = await requireHousehold();

  const code = normalizeBarcode(barcode);
  if (!code) return { kind: "error", error: "Invalid barcode" };

  const item = await prisma.inventoryItem.findFirst({
    where: { householdId: household.id, barcode: code },
    select: { id: true, name: true, unit: true },
  });
  if (item) return { kind: "known", item };

  const lookup = await fetchOpenFoodFactsProduct(code);
  return { kind: "unknown", barcode: code, name: lookup.name, category: lookup.category ?? null };
}
