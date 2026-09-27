// Flattens a recipe's ingredients plus every ingredient contributed by its
// sub-recipes (see RecipeComponent in schema.prisma) into one list, for the
// meal-plan → shopping-list bridge in actions.ts. Split out of actions.ts (a
// "use server" file, which may only export async functions) so the
// `ExpandedIngredientNeed` type can be exported and this stays unit-testable
// by mocking @/lib/prisma — mirrors missing-ingredients.ts.
import { prisma } from "@/lib/prisma";

// Recipe boxes are household-sized, not catalog-sized — this caps
// recursion depth so a bug (or a row edited directly in the database) can't
// turn a cycle into infinite recursion. assertNoComponentCycle in
// actions.ts is the real defense; this is belt-and-suspenders.
const MAX_COMPONENT_DEPTH = 10;

export type ExpandedIngredientNeed = {
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  onHandQuantity: number | null;
  // The linked InventoryItem's own unit — may differ from this
  // RecipeIngredient's `unit` (they're independent free-text fields, see
  // schema.prisma). Needed so missing-ingredients.ts only ever subtracts
  // on-hand quantity from a requirement denominated in the same unit,
  // instead of assuming the two always match.
  onHandUnit: string | null;
  name: string;
  unit: string;
  quantity: number;
};

// One node of the in-memory recipe graph fetched by loadRecipeGraph below —
// same shape prisma.recipe.findUnique used to return per node, now held for
// every recipe in the household at once.
type RecipeGraphNode = {
  ingredients: {
    inventoryItemId: string | null;
    inventoryItem: { name: string; quantity: number; unit: string } | null;
    // RecipeIngredient.untracked (MATCH-2). Optional only so hand-built
    // test graphs can leave it out; loadRecipeGraph always has it.
    untracked?: boolean;
    name: string;
    unit: string;
    quantity: number;
  }[];
  components: { componentRecipeId: string; quantity: number }[];
};

// A household's recipes (and their sub-recipe components) rarely number
// more than a few dozen, so the whole graph is cheap to hold in memory —
// unlike a per-node `findUnique`, which used to run once per recipe *and*
// once per sub-recipe component, so a meal plan with several entries each
// pulling in sub-recipes could issue dozens of round trips for one preview.
// Fetching it all up front turns that into exactly one query per call into
// this module, however deep or wide the component tree turns out to be.
//
// Exported (PERF-1) so a caller that needs to expand *several* recipes from
// the same household — the Cook tab's getCookableRecipes, and the
// meal-plan → shopping-list bridge's previewMissingIngredientsAction, both
// of which used to call expandRecipeIngredients once per recipe/entry and
// therefore re-ran this query once per recipe/entry too — can fetch the
// graph exactly once for the whole batch and walk it with expandFromGraph
// per recipe instead. expandRecipeIngredients below remains the one-shot
// convenience for a caller expanding a single recipe.
export async function loadRecipeGraph(householdId: string): Promise<Map<string, RecipeGraphNode>> {
  const recipes = await prisma.recipe.findMany({
    where: { householdId },
    include: {
      ingredients: { include: { inventoryItem: true } },
      components: { select: { componentRecipeId: true, quantity: true } },
    },
  });
  return new Map(recipes.map((recipe) => [recipe.id, recipe]));
}

// Recursively resolves `recipeId`'s own ingredients (scaled by `multiplier`)
// plus, for each sub-recipe it uses, that sub-recipe's own expansion scaled
// by `multiplier * component.quantity`. `ancestry` is the set of recipe ids
// already on the current path from the root — if `recipeId` is already in
// it, that branch is cut short rather than recursing forever. Walks the
// prefetched `recipesById` map instead of touching Prisma — a component
// id that isn't in the map (a stale id, or one from another household)
// resolves the same way a `findUnique` miss used to: nothing is added for
// that branch.
//
// Exported (PERF-1) alongside loadRecipeGraph — see that function's comment
// — so a caller batching several recipes can fetch the graph once and call
// this pure, non-DB-touching walk once per recipe.
export function expandFromGraph(
  recipesById: ReadonlyMap<string, RecipeGraphNode>,
  recipeId: string,
  multiplier: number,
  ancestry: ReadonlySet<string>,
  depth: number,
): ExpandedIngredientNeed[] {
  if (ancestry.has(recipeId) || depth > MAX_COMPONENT_DEPTH) return [];

  const recipe = recipesById.get(recipeId);
  if (!recipe) return [];

  // A "Don't track" row (MATCH-2: water, or anything the household said
  // never to track) isn't an inventory need at all, so the shopping-list
  // bridge, "Mark as cooked" and the Cook tab never see it. It still shows
  // on the recipe card. An unlinked row that isn't untracked (its item was
  // deleted) stays, and keeps matching by name downstream.
  const own: ExpandedIngredientNeed[] = recipe.ingredients
    .filter((ingredient) => !ingredient.untracked)
    .map((ingredient) => ({
      inventoryItemId: ingredient.inventoryItemId,
      inventoryItemName: ingredient.inventoryItem?.name ?? null,
      onHandQuantity: ingredient.inventoryItem?.quantity ?? null,
      onHandUnit: ingredient.inventoryItem?.unit ?? null,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity * multiplier,
    }));

  const nextAncestry = new Set(ancestry).add(recipeId);
  const nested = recipe.components.map((component) =>
    expandFromGraph(
      recipesById,
      component.componentRecipeId,
      multiplier * component.quantity,
      nextAncestry,
      depth + 1,
    ),
  );

  return [...own, ...nested.flat()];
}

// How much to scale a recipe's as-written ingredient quantities for one
// MealPlanEntry: `portions` (how many that slot is actually feeding — see
// MealPlanEntry.portions in schema.prisma) over the recipe's own `servings`
// (how many its ingredient list makes). A recipe for 4 cooked for 2 is 0.5;
// cooked for 6 it's 1.5. It's the `multiplier` handed to
// expandRecipeIngredients below by both the shopping-list bridge and "Mark
// as cooked" (cooking-actions.ts), so the two can never disagree about how
// much a meal uses. It's pulled out here, pure, so the arithmetic has one
// home and its own tests instead of two copies of an inline expression.
//
// Anything that can't give a meaningful ratio falls back to 1 ("one full
// recipe, as written") rather than 0 or Infinity. That covers a missing
// recipe, or `servings` of 0 or less (Recipe.servings is validated ≥ 1 on
// save, but a row edited directly in the database could still hold one),
// and a non-positive `portions` (validated ≥ 1 too). A 0 multiplier would
// silently drop every ingredient from the shopping list. Infinity would
// propose buying an impossible amount. Neither is safer than the recipe as
// written.
export function portionsMultiplier(portions: number, servings: number | null | undefined): number {
  if (!Number.isFinite(portions) || portions <= 0) return 1;
  if (servings == null || !Number.isFinite(servings) || servings <= 0) return 1;
  return portions / servings;
}

// Fetches the household's whole recipe graph once, then walks it from
// `recipeId`. `householdId` scopes that fetch — it isn't (and shouldn't be)
// derivable from `recipeId` alone, so every call site must pass the
// household already in scope from its own `requireHousehold()` call.
//
// This is the one-shot convenience for a caller expanding a *single*
// recipe (previewCookedIngredientsAction, markMealEntryCookedAction). A
// caller expanding several recipes from the same household in one request
// (getCookableRecipes, previewMissingIngredientsAction) must NOT call this
// in a loop — that re-fetches the whole graph once per recipe, right back
// to the O(R²) row count and R parallel queries this was meant to fix
// (PERF-1). Those callers instead call loadRecipeGraph once and then
// expandFromGraph per recipe against the shared result.
export async function expandRecipeIngredients(
  householdId: string,
  recipeId: string,
  multiplier: number,
  ancestry: ReadonlySet<string>,
): Promise<ExpandedIngredientNeed[]> {
  const recipesById = await loadRecipeGraph(householdId);
  return expandFromGraph(recipesById, recipeId, multiplier, ancestry, 0);
}
