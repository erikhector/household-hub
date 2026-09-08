// Pure aggregation/diff logic for the meal-plan → shopping-list bridge,
// split out from actions.ts (a "use server" file, which may only export
// async functions) so it's unit-testable without mocking Prisma — see
// missing-ingredients.test.ts. Resolving each RecipeIngredient to an
// InventoryItem (and reading its current quantity) still requires a
// database round-trip and stays in actions.ts; this module only does the
// pure "sum required, subtract on-hand, keep the shortfall" step.

import type { MissingIngredientData } from "@/components/meal-planning/types";

export type IngredientNeed = {
  // Identity to aggregate by — the linked InventoryItem's id when known,
  // or a `name:`-prefixed fallback key when it isn't (see actions.ts).
  key: string;
  name: string;
  unit: string;
  quantity: number;
  onHandQuantity: number;
  // The unit `onHandQuantity` is actually denominated in (the linked
  // InventoryItem's own unit), which is independent free text from
  // `unit` above (a RecipeIngredient's unit) — see schema.prisma. Null
  // when there's no linked/matched inventory item to read a unit from.
  onHandUnit: string | null;
};

const normalizeUnit = (unit: string) => unit.trim().toLowerCase();

// Sums `quantity` per (key, unit) across every need — deliberately *not*
// per key alone, since units are free text (RecipeIngredient.unit /
// InventoryItem.unit in schema.prisma) with no conversion table behind
// them. Two recipes both needing "flour" but one in cups and one in grams
// must stay separate line items rather than being silently added together
// as if they were the same measurement.
//
// For the same reason, a group's on-hand quantity is only subtracted from
// it when the on-hand unit (read once per key, not summed) matches that
// group's own unit — a mismatched on-hand unit can't be reconciled without
// a conversion table, so it's left out rather than compared as if it were
// directly comparable, and the group's full required quantity counts as
// missing. Result is sorted by name (then unit, for ties) for a stable,
// predictable review list.
export function computeMissingIngredients(needs: IngredientNeed[]): MissingIngredientData[] {
  type Accum = {
    name: string;
    unit: string;
    required: number;
    onHand: number;
    onHandUnit: string | null;
  };
  const byGroup = new Map<string, Accum>();

  for (const need of needs) {
    const groupKey = `${need.key}::${normalizeUnit(need.unit)}`;
    const existing = byGroup.get(groupKey);
    if (existing) {
      existing.required += need.quantity;
    } else {
      byGroup.set(groupKey, {
        name: need.name,
        unit: need.unit,
        required: need.quantity,
        onHand: need.onHandQuantity,
        onHandUnit: need.onHandUnit,
      });
    }
  }

  const items: MissingIngredientData[] = [];
  for (const [groupKey, accum] of byGroup) {
    const onHandUnitMatches =
      accum.onHandUnit !== null && normalizeUnit(accum.onHandUnit) === normalizeUnit(accum.unit);
    const missing = accum.required - (onHandUnitMatches ? accum.onHand : 0);
    if (missing > 0) {
      items.push({
        key: groupKey,
        name: accum.name,
        unit: accum.unit,
        missingQuantity: Math.round(missing * 100) / 100,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  return items;
}
