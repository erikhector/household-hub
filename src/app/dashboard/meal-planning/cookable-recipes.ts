// "What can I cook right now?" — surfaces recipes the household is close to
// having everything for, reusing the same expand (see recipe-expansion.ts)
// and diff (see missing-ingredients.ts) machinery as the meal-plan →
// shopping-list bridge in cooking-actions.ts, but run per-recipe against the
// full household inventory (at full-recipe scale, multiplier 1 — "one full
// batch") rather than per-meal-plan-entry against a planned week.
//
// Not a "use server" action: getCookableRecipes is only ever called from the
// meal-planning page's own server-side data fetch (page.tsx), never invoked
// from a client component, so it doesn't need the client/server RPC
// boundary — same reasoning as recipe-expansion.ts staying a plain module.
import { prisma } from "@/lib/prisma";
import { expandRecipeIngredients } from "@/app/dashboard/meal-planning/recipe-expansion";
import { computeMissingIngredients, type IngredientNeed } from "@/app/dashboard/meal-planning/missing-ingredients";

export type CookableRecipeData = {
  recipeId: string;
  recipeName: string;
  missingIngredientNames: string[];
};

// Beyond this many distinct missing ingredients, a recipe isn't "almost
// ready to cook" anymore — it's just a recipe. Capping the list to
// near-complete matches keeps this tab short and actionable instead of the
// full recipe index re-sorted by match quality.
const MAX_MISSING_TO_SURFACE = 2;

// Pure aggregation/filter/sort step — unit-tested directly (see
// cookable-recipes.test.ts), mirrors computeMissingIngredients' own split
// for the same reason.
export function computeCookableRecipes(
  recipes: { recipeId: string; recipeName: string; needs: IngredientNeed[] }[],
): CookableRecipeData[] {
  return recipes
    // A recipe with no ingredients at all has nothing to be "missing" —
    // trivially satisfying the filter below without meaning anything.
    .filter((recipe) => recipe.needs.length > 0)
    .map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      missingIngredientNames: computeMissingIngredients(recipe.needs).map((item) => item.name),
    }))
    .filter((recipe) => recipe.missingIngredientNames.length <= MAX_MISSING_TO_SURFACE)
    .sort(
      (a, b) =>
        a.missingIngredientNames.length - b.missingIngredientNames.length ||
        a.recipeName.localeCompare(b.recipeName),
    );
}

// DB-touching half: expands every recipe (including sub-recipes) against the
// household's current inventory, then hands the result to
// computeCookableRecipes above.
export async function getCookableRecipes(
  householdId: string,
  recipes: { id: string; name: string }[],
): Promise<CookableRecipeData[]> {
  const expandedByRecipe = await Promise.all(
    recipes.map((recipe) => expandRecipeIngredients(householdId, recipe.id, 1, new Set())),
  );

  // Same loose-match fallback as previewMissingIngredientsAction /
  // previewCookedIngredientsAction in cooking-actions.ts (duplicated rather
  // than shared, for the same self-containment reason given there — see
  // findOrCreateInventoryItem's comment): an ingredient's inventoryItemId is
  // normally always set (find-or-create-linked at recipe-save time), but the
  // relation is `onDelete: SetNull`, so a since-deleted inventory item can
  // leave one unlinked. Fall back to a case-insensitive name match against
  // the household's current inventory for those.
  const looseNames = new Set<string>();
  for (const expanded of expandedByRecipe) {
    for (const ingredient of expanded) {
      if (!ingredient.inventoryItemId) looseNames.add(ingredient.name.toLowerCase());
    }
  }
  const looseMatches =
    looseNames.size > 0 ? await prisma.inventoryItem.findMany({ where: { householdId } }) : [];
  const looseByName = new Map(
    looseMatches
      .filter((item) => looseNames.has(item.name.toLowerCase()))
      .map((item) => [item.name.toLowerCase(), item]),
  );

  const perRecipe = recipes.map((recipe, i) => ({
    recipeId: recipe.id,
    recipeName: recipe.name,
    needs: expandedByRecipe[i].map((ingredient): IngredientNeed => {
      if (ingredient.inventoryItemId) {
        return {
          key: ingredient.inventoryItemId,
          name: ingredient.inventoryItemName ?? ingredient.name,
          unit: ingredient.unit,
          quantity: ingredient.quantity,
          onHandQuantity: ingredient.onHandQuantity ?? 0,
          onHandUnit: ingredient.onHandUnit,
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
      };
    }),
  }));

  return computeCookableRecipes(perRecipe);
}
