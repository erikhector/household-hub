// Pure aggregation/diff logic for the meal-plan → shopping-list bridge,
// split out from actions.ts (a "use server" file, which may only export
// async functions) so it's unit-testable without mocking Prisma — see
// missing-ingredients.test.ts. Resolving each RecipeIngredient to an
// InventoryItem (and reading its current quantity) still requires a
// database round-trip and stays in actions.ts; this module only does the
// pure "sum required, subtract on-hand, keep the shortfall" step, plus the
// date-range validation both the preview action and the dialog share.

import { z } from "zod";
import type { MissingIngredientData } from "@/components/meal-planning/types";
import { convertQuantity, unitsAreComparable } from "@/lib/units";
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// --- Date range (GAP-32) -----------------------------------------------------
//
// The bridge used to be hard-scoped to one MealPlan.weekStartDate. It now
// takes any half-open `[from, to)` range of `yyyy-mm-dd` day keys, so a
// household can build one shopping list for e.g. the next two weeks before a
// big trip (the Plan to Eat / Mealime pattern). "This week" is simply
// `[weekStart, weekStart + 7)` — see weekRange below. Half-open so adjacent
// ranges never double-count a day, and so it maps 1:1 onto a Prisma
// `{ gte, lt }` filter on MealPlanEntry.date.
//
// Capped at 31 days: long enough for "the whole month" or two weeks away,
// short enough that one preview can't fan out into expanding hundreds of
// planned recipes (each entry is its own recursive expandRecipeIngredients
// walk). The dialog validates the same way before calling, but the server
// action is what enforces it — a Server Action is a public endpoint.
export const MAX_MISSING_INGREDIENTS_RANGE_DAYS = 31;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A real calendar day, not just the right shape — "2026-02-31" matches the
// regex, but `new Date` would silently roll it over into March.
const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((key) => {
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && toDateKey(date) === key;
  });

const missingIngredientsRangeSchema = z
  .object({ from: dayKeySchema, to: dayKeySchema })
  .transform(({ from, to }) => ({ from: parseDateKey(from), to: parseDateKey(to) }))
  .refine(({ from, to }) => {
    const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
    return days >= 1 && days <= MAX_MISSING_INGREDIENTS_RANGE_DAYS;
  });

// `to` is exclusive — see the half-open note above.
export type MissingIngredientsRange = { from: string; to: string };

// Parses an untrusted `{ from, to }` into UTC-midnight Dates, or null when
// it isn't a non-empty range of at most MAX_MISSING_INGREDIENTS_RANGE_DAYS
// days. Shared by previewMissingIngredientsAction and the dialog's
// custom-range inputs so both agree on what's valid.
export function parseMissingIngredientsRange(input: unknown): { from: Date; to: Date } | null {
  const parsed = missingIngredientsRangeSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// The visible planner week as a range — the dialog's default, and exactly
// the single MealPlan the bridge was scoped to before GAP-32.
export function weekRange(weekStartKey: string): MissingIngredientsRange {
  return { from: weekStartKey, to: toDateKey(addDays(parseDateKey(weekStartKey), 7)) };
}

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
        });
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.unit.localeCompare(b.unit));
  return items;
}
