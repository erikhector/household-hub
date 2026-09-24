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
async function loadRecipeGraph(householdId: string): Promise<Map<string, RecipeGraphNode>> {
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
function expandFromGraph(
  recipesById: ReadonlyMap<string, RecipeGraphNode>,
  recipeId: string,
  multiplier: number,
  ancestry: ReadonlySet<string>,
  depth: number,
): ExpandedIngredientNeed[] {
  if (ancestry.has(recipeId) || depth > MAX_COMPONENT_DEPTH) return [];

  const recipe = recipesById.get(recipeId);
  if (!recipe) return [];

  const own: ExpandedIngredientNeed[] = recipe.ingredients.map((ingredient) => ({
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

// Fetches the household's whole recipe graph once, then walks it from
// `recipeId`. `householdId` scopes that fetch — it isn't (and shouldn't be)
// derivable from `recipeId` alone, so every call site must pass the
// household already in scope from its own `requireHousehold()` call. A
// caller that needs to expand several recipes from the same household in
// one go (e.g. cookable-recipes.ts, checking every recipe against current
// inventory) calls this once per recipe, same as before — each call is now
// a single batched query rather than one-per-node, so that's still a large
// reduction in round trips without needing to restructure those call sites.
export async function expandRecipeIngredients(
  householdId: string,
  recipeId: string,
  multiplier: number,
  ancestry: ReadonlySet<string>,
): Promise<ExpandedIngredientNeed[]> {
  const recipesById = await loadRecipeGraph(householdId);
  return expandFromGraph(recipesById, recipeId, multiplier, ancestry, 0);
}
