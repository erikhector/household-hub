// Pure aggregation logic for the "mark meal as cooked" → inventory decrement
// bridge, split out from actions.ts (a "use server" file, which may only
// export async functions) so it's unit-testable without mocking Prisma —
// mirrors missing-ingredients.ts. Resolving each RecipeIngredient to an
// InventoryItem still requires a database round-trip and stays in
// actions.ts; this module only does the pure "sum required quantity per
// inventory item, only where units reconcile" step.

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
  // required quantity when every contributing row's unit matches the
  // inventory item's own unit, else 0 (the household must enter the amount
  // themselves — there's no conversion table to lean on).
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
// own). A row whose required unit doesn't match the inventory item's unit
// can't be reconciled without a conversion table, so it's flagged rather
// than summed into the suggested quantity — matching
// computeMissingIngredients' onHandUnitMatches handling of the same
// problem. Result is sorted by name for a stable, predictable review list.
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
    const matches = normalizeUnit(need.requiredUnit) === normalizeUnit(need.onHandUnit);
    const existing = byItem.get(need.inventoryItemId);
    if (existing) {
      existing.requiredQuantity += need.requiredQuantity;
      if (matches) {
        existing.suggestedQuantity += need.requiredQuantity;
      } else {
        existing.unitMismatch = true;
      }
    } else {
      byItem.set(need.inventoryItemId, {
        name: need.name,
        unit: need.onHandUnit,
        onHandQuantity: need.onHandQuantity,
        suggestedQuantity: matches ? need.requiredQuantity : 0,
        requiredQuantity: need.requiredQuantity,
        requiredUnit: need.requiredUnit,
        unitMismatch: !matches,
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
