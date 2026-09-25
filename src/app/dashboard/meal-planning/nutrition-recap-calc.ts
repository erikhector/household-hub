// Pure aggregation logic for the meal-planning "nutrition recap" (BACKLOG
// GAP-2) — split out from page.tsx so it's unit-testable without Prisma,
// mirroring meal-variety-calc.ts. Sums the *current week's* planned entries'
// per-serving nutrition fields (Recipe.caloriesPerServing and friends, see
// their doc comment in schema.prisma) into a soft "here's your week" total.
//
// Deliberately NOT a goal/target tracker: there's no macro target to compare
// against, no over/under framing, and no history across weeks — just this
// week's planned total, the same "quiet week produces nothing, not a
// zero/penalty" framing as computeMealVarietyRecap. A bigger, opt-in
// goal-setting feature is a separate, later effort — see REQUIREMENTS.md's
// "Weekly nutrition recap" section for why that's out of scope here.

export type NutritionRecapEntry = {
  // Null on a freeform entry (no linked recipe) — freeform entries never
  // contribute, since there's no nutrition to look up for them.
  recipeId: string | null;
  // MealPlanEntry.portions — already a serving count (not a multiplier on
  // Recipe.servings), so each per-serving field is scaled directly by this,
  // matching how RecipeManager and the ingredient-expansion logic both treat
  // "per serving" as a single-serving figure. See MealPlanEntry.portions'
  // doc comment in schema.prisma.
  portions: number;
  caloriesPerServing: number | null;
  proteinGramsPerServing: number | null;
  carbsGramsPerServing: number | null;
  fatGramsPerServing: number | null;
};

export type NutritionRecapTotals = {
  // Each total is independently nullable — a recipe can have calories set
  // with the rest left blank (see Recipe's doc comment), so e.g. a week
  // where every planned recipe has calories but no protein entered should
  // still show a calorie total rather than showing nothing at all.
  totalCalories: number | null;
  totalProteinGrams: number | null;
  totalCarbsGrams: number | null;
  totalFatGrams: number | null;
  // How many entries contributed at least one field to the totals above —
  // the caller only renders the recap card when this is > 0, the same gate
  // MealVarietyRecap uses for its distinct-recipe count.
  contributingEntryCount: number;
};

/**
 * Sums each nutrition field independently across `entries` (expected to
 * already be scoped to the currently-displayed week — see page.tsx). A
 * freeform entry, or a recipe with all four fields null, contributes
 * nothing. Each field is summed only where it's actually set on that entry's
 * recipe, so a week mixing "has calories" and "has protein" recipes still
 * totals both instead of one all-or-nothing figure.
 */
export function computeNutritionRecap(entries: NutritionRecapEntry[]): NutritionRecapTotals {
  let totalCalories = 0;
  let totalProteinGrams = 0;
  let totalCarbsGrams = 0;
  let totalFatGrams = 0;
  let hasCalories = false;
  let hasProtein = false;
  let hasCarbs = false;
  let hasFat = false;
  let contributingEntryCount = 0;

  for (const entry of entries) {
    if (entry.recipeId === null) continue; // freeform meal — no recipe, no nutrition

    const contributes =
      entry.caloriesPerServing !== null ||
      entry.proteinGramsPerServing !== null ||
      entry.carbsGramsPerServing !== null ||
      entry.fatGramsPerServing !== null;
    if (!contributes) continue;
    contributingEntryCount += 1;

    if (entry.caloriesPerServing !== null) {
      totalCalories += entry.caloriesPerServing * entry.portions;
      hasCalories = true;
    }
    if (entry.proteinGramsPerServing !== null) {
      totalProteinGrams += entry.proteinGramsPerServing * entry.portions;
      hasProtein = true;
    }
    if (entry.carbsGramsPerServing !== null) {
      totalCarbsGrams += entry.carbsGramsPerServing * entry.portions;
      hasCarbs = true;
    }
    if (entry.fatGramsPerServing !== null) {
      totalFatGrams += entry.fatGramsPerServing * entry.portions;
      hasFat = true;
    }
  }

  return {
    // Rounded for display (matches nutritionCaloriesValue etc. in
    // RecipeManager, which round-trip whole/near-whole numbers already) —
    // summed Float fields can otherwise land on an ugly fractional total.
    totalCalories: hasCalories ? Math.round(totalCalories) : null,
    totalProteinGrams: hasProtein ? Math.round(totalProteinGrams) : null,
    totalCarbsGrams: hasCarbs ? Math.round(totalCarbsGrams) : null,
    totalFatGrams: hasFat ? Math.round(totalFatGrams) : null,
    contributingEntryCount,
  };
}
