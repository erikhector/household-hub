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
};

// Sums `quantity` per `key` across every need, subtracts each key's
// on-hand quantity (read once per key, not summed), and keeps only the
// keys where the result is positive — i.e. only ingredients the household
// doesn't already have enough of. Result is sorted by name for a stable,
// predictable review list.
export function computeMissingIngredients(needs: IngredientNeed[]): MissingIngredientData[] {
  type Accum = { name: string; unit: string; required: number; onHand: number };
  const byKey = new Map<string, Accum>();

  for (const need of needs) {
    const existing = byKey.get(need.key);
    if (existing) {
      existing.required += need.quantity;
    } else {
      byKey.set(need.key, {
        name: need.name,
        unit: need.unit,
        required: need.quantity,
        onHand: need.onHandQuantity,
      });
    }
  }

  const items: MissingIngredientData[] = [];
  for (const [key, accum] of byKey) {
    const missing = accum.required - accum.onHand;
    if (missing > 0) {
      items.push({
        key,
        name: accum.name,
        unit: accum.unit,
        missingQuantity: Math.round(missing * 100) / 100,
      });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}
