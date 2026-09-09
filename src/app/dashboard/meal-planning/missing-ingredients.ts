// Pure aggregation/diff logic for the meal-plan → shopping-list bridge,
// split out from actions.ts (a "use server" file, which may only export
// async functions) so it's unit-testable without mocking Prisma — see
// missing-ingredients.test.ts. Resolving each RecipeIngredient to an
// InventoryItem (and reading its current quantity) still requires a
// database round-trip and stays in actions.ts; this module only does the
// pure "sum required, subtract on-hand, keep the shortfall" step.

import type { MissingIngredientData } from "@/components/meal-planning/types";
import { convertQuantity, unitsAreComparable } from "@/lib/units";

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
const round2 = (n: number) => Math.round(n * 100) / 100;

// Sums `quantity` per ingredient (key), then splits that total across one
// or more "unit clusters" — groups of requirements whose units are either
// identical or convertible into each other via src/lib/units.ts (e.g. a
// recipe needing 2 tbsp and another needing 1 tsp of the same olive oil
// combine into a single cluster). Units from a genuinely different
// dimension (grams vs cups — that needs ingredient-specific density we
// don't have) or that aren't recognized at all stay in their own cluster,
// exactly as if there were no conversion table.
//
// Within a cluster, the household's on-hand quantity is subtracted after
// converting it into the cluster's unit (again, only when the on-hand unit
// is comparable) — so e.g. 1 liter of olive oil on hand correctly covers a
// recipe that calls for 3 tablespoons, instead of being reported as fully
// missing just because the unit strings differ. Result is sorted by name
// (then unit, for ties) for a stable, predictable review list.
export function computeMissingIngredients(needs: IngredientNeed[]): MissingIngredientData[] {
  const byKey = new Map<string, IngredientNeed[]>();
  for (const need of needs) {
    const existing = byKey.get(need.key);
    if (existing) existing.push(need);
    else byKey.set(need.key, [need]);
  }

  const items: MissingIngredientData[] = [];

  for (const [key, keyNeeds] of byKey) {
    const name = keyNeeds[0].name;
    const onHandQuantity = keyNeeds[0].onHandQuantity;
    const onHandUnit = keyNeeds[0].onHandUnit;

    const clusters: { unit: string; required: number }[] = [];
    for (const need of keyNeeds) {
      const cluster = clusters.find((c) => unitsAreComparable(c.unit, need.unit));
      if (cluster) {
        const sameUnit = normalizeUnit(cluster.unit) === normalizeUnit(need.unit);
        cluster.required += sameUnit ? need.quantity : convertQuantity(need.quantity, need.unit, cluster.unit)!;
      } else {
        clusters.push({ unit: need.unit, required: need.quantity });
      }
    }

    for (const cluster of clusters) {
      let onHandInClusterUnit = 0;
      if (onHandUnit !== null && unitsAreComparable(onHandUnit, cluster.unit)) {
        onHandInClusterUnit =
          normalizeUnit(onHandUnit) === normalizeUnit(cluster.unit)
            ? onHandQuantity
            : convertQuantity(onHandQuantity, onHandUnit, cluster.unit)!;
      }

      const missing = cluster.required - onHandInClusterUnit;
      if (missing > 0) {
        items.push({
          key: `${key}::${normalizeUnit(cluster.unit)}`,
          name,
          unit: cluster.unit,
          missingQuantity: round2(missing),
        });
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  return items;
}
