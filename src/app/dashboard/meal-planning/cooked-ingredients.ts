// Pure aggregation logic for the "mark meal as cooked" → inventory decrement
// bridge, split out from actions.ts (a "use server" file, which may only
// export async functions) so it's unit-testable without mocking Prisma —
// mirrors missing-ingredients.ts. Resolving each RecipeIngredient to an
// InventoryItem still requires a database round-trip and stays in
// actions.ts; this module only does the pure "sum required quantity per
// inventory item, converting into the inventory item's own unit where
// possible" step.

import { convertForItem, type ItemUnitConversionLike } from "@/lib/units";

export type CookedIngredientNeed = {
  inventoryItemId: string;
  name: string;
  onHandQuantity: number;
  // The linked InventoryItem's own unit — decrementing is always
  // denominated in this unit, never the recipe's (they're independent free
  // text, see schema.prisma).
  onHandUnit: string;
  // The recipe's scaled requirement for this ingredient, and the unit it's
  // expressed in.
  requiredQuantity: number;
  requiredUnit: string;
  // The item's saved conversions (ItemUnitConversion, MATCH-3), tried when
  // the generic table can't convert `requiredUnit` into `onHandUnit`.
  conversions?: readonly ItemUnitConversionLike[];
};

export type CookedIngredientData = {
  // Identity to aggregate by, and what the confirm form submits against —
  // the linked InventoryItem's id.
  key: string;
  inventoryItemId: string;
  name: string;
  unit: string;
  onHandQuantity: number;
  // Defaults the confirm dialog's editable quantity input: the summed
  // required quantity — converted into the inventory item's own unit via
  // src/lib/units.ts's convertForItem (the generic table, or the item's own
  // saved conversions, MATCH-3) — when every contributing row's unit
  // reconciles that way, else 0 (the household must enter the amount
  // themselves: an unrecognized unit, or one from a different dimension like
  // cups vs grams, can't be converted until the item has a conversion).
  suggestedQuantity: number;
  // The recipe-side requirement, kept for display when units mismatch so
  // the household has something to convert from.
  requiredQuantity: number;
  requiredUnit: string;
  unitMismatch: boolean;
};

// Groups by inventory item (not by item+unit like computeMissingIngredients
// — there's only ever one unit to decrement in here, the inventory item's
// own). A row whose required unit can't be reconciled with the inventory
// item's unit (unrecognized, or a different dimension) is flagged rather
// than summed into the suggested quantity — matching
// computeMissingIngredients' on-hand handling of the same problem. Result
// is sorted by name for a stable, predictable review list.
export function computeCookedIngredients(needs: CookedIngredientNeed[]): CookedIngredientData[] {
  type Accum = {
    name: string;
    unit: string;
    onHandQuantity: number;
    suggestedQuantity: number;
    requiredQuantity: number;
    requiredUnit: string;
    unitMismatch: boolean;
  };
  const byItem = new Map<string, Accum>();

  for (const need of needs) {
    const converted = convertForItem(
      need.requiredQuantity,
      need.requiredUnit,
      { unit: need.onHandUnit },
      need.conversions,
    );
    const comparable = converted !== null;
    const contribution = converted ?? 0;

    const existing = byItem.get(need.inventoryItemId);
    if (existing) {
      existing.requiredQuantity += need.requiredQuantity;
      if (comparable) {
        existing.suggestedQuantity += contribution;
      } else {
        existing.unitMismatch = true;
      }
    } else {
      byItem.set(need.inventoryItemId, {
        name: need.name,
        unit: need.onHandUnit,
        onHandQuantity: need.onHandQuantity,
        suggestedQuantity: contribution,
        requiredQuantity: need.requiredQuantity,
        requiredUnit: need.requiredUnit,
        unitMismatch: !comparable,
      });
    }
  }

  const items: CookedIngredientData[] = [...byItem.entries()].map(([inventoryItemId, accum]) => ({
    key: inventoryItemId,
    inventoryItemId,
    name: accum.name,
    unit: accum.unit,
    onHandQuantity: accum.onHandQuantity,
    suggestedQuantity: Math.round(accum.suggestedQuantity * 100) / 100,
    requiredQuantity: Math.round(accum.requiredQuantity * 100) / 100,
    requiredUnit: accum.requiredUnit,
    unitMismatch: accum.unitMismatch,
  }));

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
