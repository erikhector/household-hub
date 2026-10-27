// Pure aggregation/diff logic for the meal-plan → shopping-list bridge,
// split out from actions.ts (a "use server" file, which may only export
// async functions) so it's unit-testable without mocking Prisma — see
// missing-ingredients.test.ts. Resolving each RecipeIngredient to an
// InventoryItem (and reading its current quantity) still requires a
// database round-trip and stays in actions.ts; this module only does the
// pure "sum required, subtract on-hand, keep the shortfall" step, plus the
// date-range validation both the preview action and the dialog share.

import type { MissingIngredientData } from "@/components/meal-planning/types";
import { round2 } from "@/lib/math";
import {
  convertForItem,
  convertQuantity,
  normalizeUnit,
  unitsAreComparable,
  type ItemUnitConversionLike,
} from "@/lib/units";

// The date-range half (GAP-32) lives in missing-ingredients-range.ts so the
// client dialog can use it without this file's server-only weight; re-exported
// here so server callers keep one import.
export {
  MAX_MISSING_INGREDIENTS_RANGE_DAYS,
  parseMissingIngredientsRange,
  weekRange,
  type MissingIngredientsRange,
} from "@/app/dashboard/meal-planning/missing-ingredients-range";

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
  // The matched item's saved conversions (ItemUnitConversion, MATCH-3),
  // for a recipe unit the generic table can't turn into `onHandUnit`.
  conversions?: readonly ItemUnitConversionLike[];
  // The recipe ingredient's note (GAP-62). Optional so callers that don't
  // care (and older tests) can leave it out.
  note?: string | null;
};

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
    const conversions = keyNeeds[0].conversions ?? [];

    // MATCH-3: a requirement only the item's own conversions can reconcile
    // ("300 g" of flour counted in pcs, with 1 pcs = 2000 g saved) is
    // restated in the item's unit first, so it joins that unit's cluster
    // and on-hand stock covers it like any other. The generic-table
    // clustering below is unchanged for everything else.
    const restated = keyNeeds.map((need) => {
      if (onHandUnit === null || unitsAreComparable(need.unit, onHandUnit)) return need;
      const converted = convertForItem(need.quantity, need.unit, { unit: onHandUnit }, conversions);
      return converted === null ? need : { ...need, unit: onHandUnit, quantity: converted };
    });

    // GAP-62: a cluster keeps the first non-blank note among its needs, the
    // same "first row wins, never merge text" rule the list's own dedupe
    // uses, so two recipes noting the same item don't glue sentences together.
    const clusters: { unit: string; required: number; note: string | null }[] = [];
    for (const need of restated) {
      const cluster = clusters.find((c) => unitsAreComparable(c.unit, need.unit));
      const note = need.note?.trim() || null;
      if (cluster) {
        cluster.note ??= note;
        const sameUnit = normalizeUnit(cluster.unit) === normalizeUnit(need.unit);
        cluster.required += sameUnit ? need.quantity : convertQuantity(need.quantity, need.unit, cluster.unit)!;
      } else {
        clusters.push({ unit: need.unit, required: need.quantity, note });
      }
    }

    for (const cluster of clusters) {
      let onHandInClusterUnit = 0;
      // Distinguishes "no matching inventory item at all" (onHandUnit null —
      // genuinely fully missing) from "there IS on-hand stock, but its unit
      // can't be reconciled with this cluster's" (flagged below rather than
      // silently treated the same way) — mirrors
      // computeCookedIngredients.unitMismatch handling of the identical case.
      let unitMismatch = false;
      if (onHandUnit !== null) {
        if (unitsAreComparable(onHandUnit, cluster.unit)) {
          onHandInClusterUnit =
            normalizeUnit(onHandUnit) === normalizeUnit(cluster.unit)
              ? onHandQuantity
              : convertQuantity(onHandQuantity, onHandUnit, cluster.unit)!;
        } else {
          unitMismatch = true;
        }
      }

      const missing = cluster.required - onHandInClusterUnit;
      if (missing > 0) {
        items.push({
          key: `${key}::${normalizeUnit(cluster.unit)}`,
          name,
          unit: cluster.unit,
          missingQuantity: round2(missing),
          unitMismatch,
          note: cluster.note,
        });
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  return items;
}
