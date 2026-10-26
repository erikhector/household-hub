import { prisma } from "@/lib/prisma";
import {
  computeMissingIngredients,
  type IngredientNeed,
} from "@/app/dashboard/meal-planning/missing-ingredients";
import {
  loadRecipeGraph,
  expandFromGraph,
  portionsMultiplier,
} from "@/app/dashboard/meal-planning/recipe-expansion";
import type { MissingIngredientData } from "@/components/meal-planning/types";

// What the planner's week still needs from the shop: the shared read behind
// the review dialog's preview action (cooking-actions.ts) and the planner's
// "Add N missing" button (UX-91, counted on the server in page.tsx so the
// button never pops in after the week). `range` is already validated by
// parseMissingIngredientsRange; callers scope it to their own household.
export async function loadMissingIngredients(
  householdId: string,
  range: { from: Date; to: Date },
): Promise<{ items: MissingIngredientData[] }> {
  // Filters on each entry's own `date` rather than looking up one MealPlan
  // by weekStartDate, so a range can span several weeks' MealPlan rows (or
  // start mid-week) — the same shape the meal-variety recap's query in
  // page.tsx already uses. The household scope goes through the entry's
  // MealPlan, the same `mealPlan: { householdId }` guard loadCookableEntry
  // uses. For the default "this week" range this selects the same entries
  // as the old single-MealPlan lookup: the planner only ever dates an entry
  // on one of its own plan's seven days (the week grid's day cells, and
  // copyWeekAction's day-offset shift in planner-actions.ts).
  const entries = await prisma.mealPlanEntry.findMany({
    where: {
      mealPlan: { householdId: householdId },
      date: { gte: range.from, lt: range.to },
      recipeId: { not: null },
    },
    select: { recipeId: true, portions: true, recipe: { select: { servings: true } } },
  });

  if (entries.length === 0) {
    return { items: [] };
  }

  // Each entry's recipeId is expanded recursively — its own ingredients plus
  // every ingredient contributed by its sub-recipes (see RecipeComponent in
  // schema.prisma) — into one flat list. See recipe-expansion.ts.
  //
  // The multiplier scales the recipe's as-written ingredient quantities down
  // (or up) to how many portions this specific entry is cooking — see
  // MealPlanEntry.portions' doc comment in schema.prisma. Two entries of the
  // same 4-portion recipe each cooking 2 portions (e.g. lasagna for Thursday
  // dinner and Friday lunch) therefore total 1 full batch, not 2. The ratio
  // itself (and its no-scaling fallback) is portionsMultiplier in
  // recipe-expansion.ts.
  //
  // PERF-1: this used to call expandRecipeIngredients (one loadRecipeGraph
  // query each) once per entry, so a week with several planned meals issued
  // one query per entry on every preview. Loading the graph once for the
  // whole range and walking it per entry with expandFromGraph keeps the
  // same expansion (cycle handling, scaling, component recipes) at one
  // query total.
  const recipesById = await loadRecipeGraph(householdId);
  const expanded = entries.flatMap((entry) =>
    expandFromGraph(
      recipesById,
      entry.recipeId!,
      portionsMultiplier(entry.portions, entry.recipe?.servings),
      new Set(),
      0,
    ),
  );

  // Every ingredient is normally linked to an InventoryItem at recipe-save
  // time (see "Ingredient → inventory linking" in REQUIREMENTS.md), but the
  // relation is `onDelete: SetNull`, so a since-deleted inventory item can
  // leave an ingredient unlinked. Fall back to a case-insensitive name match
  // against the household's current inventory for those, same identity rule
  // the find-or-create paths elsewhere in this app use.
  const looseNames = new Set<string>();
  for (const ingredient of expanded) {
    if (!ingredient.inventoryItemId) looseNames.add(ingredient.name.toLowerCase());
  }
  const looseMatches =
    looseNames.size > 0
      ? await prisma.inventoryItem.findMany({
          where: { householdId: householdId },
          include: { unitConversions: { select: { fromUnit: true, factor: true } } },
        })
      : [];
  const looseByName = new Map(
    looseMatches
      .filter((item) => looseNames.has(item.name.toLowerCase()))
      .map((item) => [item.name.toLowerCase(), item]),
  );

  const needs: IngredientNeed[] = expanded.map((ingredient) => {
    if (ingredient.inventoryItemId) {
      return {
        key: ingredient.inventoryItemId,
        name: ingredient.inventoryItemName ?? ingredient.name,
        unit: ingredient.unit,
        quantity: ingredient.quantity,
        onHandQuantity: ingredient.onHandQuantity ?? 0,
        onHandUnit: ingredient.onHandUnit,
        conversions: ingredient.conversions,
        note: ingredient.note,
      };
    }
    const loose = looseByName.get(ingredient.name.toLowerCase());
    return {
      key: loose ? loose.id : `name:${ingredient.name.toLowerCase()}`,
      name: loose?.name ?? ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity,
      onHandQuantity: loose?.quantity ?? 0,
      onHandUnit: loose?.unit ?? null,
      conversions: loose?.unitConversions ?? [],
      note: ingredient.note,
    };
  });

  // Only ingredients the household doesn't already have enough of are
  // proposed — never an item that's already sufficiently stocked. This
  // aggregate/diff/filter/sort step is pure — see missing-ingredients.ts.
  return { items: computeMissingIngredients(needs) };
}
