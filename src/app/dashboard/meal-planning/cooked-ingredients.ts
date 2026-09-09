// Pure aggregation logic for the "mark meal as cooked" → inventory decrement
// bridge, split out from actions.ts (a "use server" file, which may only
// export async functions) so it's unit-testable without mocking Prisma —
// mirrors missing-ingredients.ts. Resolving each RecipeIngredient to an
// InventoryItem still requires a database round-trip and stays in
// actions.ts; this module only does the pure "sum required quantity per
// inventory item, converting into the inventory item's own unit where
// possible" step.

import { convertQuantity, unitsAreComparable } from "@/lib/units";

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
  // src/lib/units.ts where the two units are recognized and comparable —
  // when every contributing row's unit reconciles that way, else 0 (the
  // household must enter the amount themselves — there's no way to convert
  // an unrecognized unit, or one from a different dimension like cups vs
  // grams, without ingredient-specific data we don't have).
  suggestedQuantity: number;
  // The recipe-side requirement, kept for display when units mismatch so
  // the household has something to convert from.
  requiredQuantity: number;
  requiredUnit: string;
  unitMismatch: boolean;
};

const normalizeUnit = (unit: string) => unit.trim().toLowerCase();

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
    const comparable = unitsAreComparable(need.requiredUnit, need.onHandUnit);
    const contribution = comparable
      ? normalizeUnit(need.requiredUnit) === normalizeUnit(need.onHandUnit)
        ? need.requiredQuantity
        : convertQuantity(need.requiredQuantity, need.requiredUnit, need.onHandUnit)!
      : 0;

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
