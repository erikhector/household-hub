// Merging duplicate pantry items (MATCH-7, design §6.3): what the keeper
// ends up with. Pure, so the merge dialog's preview and
// mergeInventoryItemsAction compute exactly the same outcome, the way
// "Change unit…" shares planUnitChange.

import { canonicalUnit, convertForItem, convertQuantity, type ItemUnitConversionLike } from "@/lib/units";
import { normalizeItemName } from "@/lib/item-matching";
import { conversionProblem, isFactorInRange, roundAmount } from "@/lib/inventory/item-units";

export const MAX_MERGE_ITEMS = 10;

export type MergeItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  lastKnownPrice: number | null;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
  category: string;
  barcode: string | null;
  conversions: readonly ItemUnitConversionLike[];
};

/**
 * How many of the keeper's unit one of `merged`'s unit is, or null when
 * nothing says: the generic table or the keeper's conversions first (what
 * convertForItem does for recipes), then the merged item's own conversion
 * from the keeper's unit read backwards ("1 pcs = 2 dl" saved on a
 * crème fraiche counted in dl means 1 dl = 0.5 pcs).
 */
export function mergeUnitFactor(keeper: MergeItem, merged: MergeItem): number | null {
  const direct = convertForItem(1, merged.unit, keeper, keeper.conversions);
  if (direct !== null) return direct;
  const backwards = convertForItem(1, keeper.unit, merged, merged.conversions);
  return backwards !== null && backwards > 0 ? roundAmount(1 / backwards) : null;
}

export type MergedItemPlan = {
  id: string;
  /** Keeper units per one of this item's unit. */
  factor: number;
  /** This item's stock in the keeper's unit. */
  quantity: number;
};

export type MergePlan = {
  quantity: number;
  lowStockThreshold: number;
  lastKnownPrice: number | null;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
  category: string;
  barcode: string | null;
  /** Which of the fields above came from a merged item (an empty value on
   * the keeper), for the preview to say so. */
  fromMerged: { lowStockThreshold: boolean; lastKnownPrice: boolean; expiresAt: boolean; category: boolean; barcode: boolean };
  /** Barcodes on merged items that the keeper can't take, because it has
   * one already (or took another). They're removed with their item. */
  droppedBarcodes: string[];
  /** New ItemUnitConversion rows for the keeper: each typed factor, then
   * the merged items' own conversions re-expressed in the keeper's unit.
   * Never one the keeper already has (its own row wins) or one the
   * generic table makes pointless. */
  conversions: { fromUnit: string; factor: number }[];
  /** Normalized names to save as aliases of the keeper, so the next
   * import of a merged item's name matches the keeper. */
  aliases: string[];
  items: MergedItemPlan[];
};

/**
 * What merging `merged` into `keeper` does (design §6.3's table), given a
 * typed factor for each merged item whose unit can't otherwise be
 * converted. Those items are listed under `missingFactor` until one is
 * given, and add nothing to the stock meanwhile, so the preview can still
 * show everything else.
 */
export function planMerge(
  keeper: MergeItem,
  merged: readonly MergeItem[],
  typedFactors: ReadonlyMap<string, number>,
): { plan: MergePlan; missingFactor: string[]; badFactor: string[] } {
  const missingFactor: string[] = [];
  const badFactor: string[] = [];
  const items: MergedItemPlan[] = [];
  const conversions: { fromUnit: string; factor: number }[] = [];
  const taken = new Set(keeper.conversions.map((conversion) => canonicalUnit(conversion.fromUnit)));
  const addConversion = (fromUnit: string, factor: number) => {
    const unit = canonicalUnit(fromUnit);
    const rounded = roundAmount(factor);
    if (taken.has(unit) || conversionProblem(unit, keeper.unit) !== null || !isFactorInRange(rounded)) return;
    taken.add(unit);
    conversions.push({ fromUnit: unit, factor: rounded });
  };

  for (const item of merged) {
    let factor = mergeUnitFactor(keeper, item);
    if (factor === null) {
      const typed = typedFactors.get(item.id);
      if (typed === undefined) {
        missingFactor.push(item.id);
        continue;
      }
      if (!isFactorInRange(typed)) {
        badFactor.push(item.id);
        continue;
      }
      factor = typed;
    }
    // Unless the keeper already converts this unit, the factor is saved on
    // it, so the recipe and list rows that move over in this item's unit
    // reconcile too.
    if (convertForItem(1, item.unit, keeper, keeper.conversions) === null) addConversion(item.unit, factor);
    items.push({ id: item.id, factor, quantity: roundAmount(item.quantity * factor) });
  }

  // "1 X = c merged units" becomes "1 X = c × factor keeper units".
  for (const plan of items) {
    const item = merged.find((candidate) => candidate.id === plan.id)!;
    for (const conversion of item.conversions) addConversion(conversion.fromUnit, conversion.factor * plan.factor);
  }

  const planned = items.map((plan) => ({ plan, item: merged.find((candidate) => candidate.id === plan.id)! }));

  // An empty value on the keeper takes the first merged item's.
  const threshold = planned.find(({ item }) => item.lowStockThreshold > 0);
  const takeThreshold = keeper.lowStockThreshold <= 0 && threshold !== undefined;
  const price = merged.find((item) => item.lastKnownPrice !== null);
  const takePrice = keeper.lastKnownPrice === null && price !== undefined;
  const category = merged.find((item) => item.category.trim() !== "");
  const takeCategory = keeper.category.trim() === "" && category !== undefined;
  // Only a merged item with stock has a real expiry to hand over: a date on
  // an empty item is left over from stock that's gone. The earliest wins.
  const expiring = merged
    .filter((item) => item.expiresAt !== null && item.quantity > 0)
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())[0];
  const takeExpiry = keeper.expiresAt === null && expiring !== undefined;
  const withBarcode = merged.filter((item) => item.barcode !== null);
  const takeBarcode = keeper.barcode === null && withBarcode.length > 0;

  const keeperName = normalizeItemName(keeper.name);
  const aliases = [
    ...new Set(merged.map((item) => normalizeItemName(item.name)).filter((name) => name && name !== keeperName)),
  ];

  return {
    missingFactor,
    badFactor,
    plan: {
      quantity: roundAmount(items.reduce((sum, plan) => sum + plan.quantity, keeper.quantity)),
      lowStockThreshold: takeThreshold
        ? roundAmount(threshold.item.lowStockThreshold * threshold.plan.factor)
        : keeper.lowStockThreshold,
      lastKnownPrice: takePrice ? price.lastKnownPrice : keeper.lastKnownPrice,
      expiresAt: takeExpiry ? expiring.expiresAt : keeper.expiresAt,
      expiresAtEstimated: takeExpiry ? expiring.expiresAtEstimated : keeper.expiresAtEstimated,
      category: takeCategory ? category.category : keeper.category,
      barcode: takeBarcode ? withBarcode[0].barcode : keeper.barcode,
      fromMerged: {
        lowStockThreshold: takeThreshold,
        lastKnownPrice: takePrice,
        expiresAt: takeExpiry,
        category: takeCategory,
        barcode: takeBarcode,
      },
      droppedBarcodes: withBarcode.slice(takeBarcode ? 1 : 0).map((item) => item.barcode!),
      conversions,
      aliases,
      items,
    },
  };
}

/** `quantity` of `fromUnit` in `toUnit`, for two list rows of the same
 * item: through the generic table, else both through the item's unit. */
export function convertBetweenUnits(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  item: { unit: string },
  conversions: readonly ItemUnitConversionLike[],
): number | null {
  const generic = convertQuantity(quantity, fromUnit, toUnit);
  if (generic !== null) return generic;
  const inItemUnit = convertForItem(quantity, fromUnit, item, conversions);
  const perTarget = convertForItem(1, toUnit, item, conversions);
  return inItemUnit !== null && perTarget ? inItemUnit / perTarget : null;
}

export type PendingListRow = {
  id: string;
  shoppingListId: string;
  inventoryItemId: string | null;
  quantity: number;
  unit: string;
  estimatedPrice: number | null;
  note: string | null;
};

export type ListRowMerge = {
  updates: { id: string; quantity: number; estimatedPrice: number | null; note: string | null }[];
  deletes: string[];
};

/**
 * Pending rows that would end up twice on one list once they all point at
 * the keeper. A merged item's row is added into the keeper's row on the
 * same list (or, without one, into the first merged row there) when its
 * unit converts, and deleted. A row whose unit doesn't convert stays as a
 * second row. Prices add up; the kept row's note wins.
 */
export function planListRowMerges(
  rows: readonly PendingListRow[],
  keeperId: string,
  convert: (quantity: number, fromUnit: string, toUnit: string) => number | null,
): ListRowMerge {
  const byList = new Map<string, PendingListRow[]>();
  for (const row of rows) {
    const list = byList.get(row.shoppingListId);
    if (list) list.push(row);
    else byList.set(row.shoppingListId, [row]);
  }

  const updates: ListRowMerge["updates"] = [];
  const deletes: string[] = [];
  for (const listRows of byList.values()) {
    const target = listRows.find((row) => row.inventoryItemId === keeperId) ?? listRows[0];
    const next = { quantity: target.quantity, estimatedPrice: target.estimatedPrice, note: target.note };
    let changed = false;
    for (const row of listRows) {
      if (row === target || row.inventoryItemId === keeperId) continue;
      const quantity = convert(row.quantity, row.unit, target.unit);
      if (quantity === null) continue;
      next.quantity = roundAmount(next.quantity + quantity);
      if (row.estimatedPrice !== null) next.estimatedPrice = roundAmount((next.estimatedPrice ?? 0) + row.estimatedPrice);
      next.note ??= row.note;
      deletes.push(row.id);
      changed = true;
    }
    if (changed) updates.push({ id: target.id, ...next });
  }
  return { updates, deletes };
}
