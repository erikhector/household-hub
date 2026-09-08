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
  name: string;
  unit: string;
  quantity: number;
};

// Recursively resolves `recipeId`'s own ingredients (scaled by `multiplier`)
// plus, for each sub-recipe it uses, that sub-recipe's own expansion scaled
// by `multiplier * component.quantity`. `ancestry` is the set of recipe ids
// already on the current path from the root — if `recipeId` is already in
// it, that branch is cut short rather than recursing forever.
export async function expandRecipeIngredients(
  recipeId: string,
  multiplier: number,
  ancestry: ReadonlySet<string>,
  depth = 0,
): Promise<ExpandedIngredientNeed[]> {
  if (ancestry.has(recipeId) || depth > MAX_COMPONENT_DEPTH) return [];

  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: {
      ingredients: { include: { inventoryItem: true } },
      components: { select: { componentRecipeId: true, quantity: true } },
    },
  });
  if (!recipe) return [];

  const own: ExpandedIngredientNeed[] = recipe.ingredients.map((ingredient) => ({
    inventoryItemId: ingredient.inventoryItemId,
    inventoryItemName: ingredient.inventoryItem?.name ?? null,
    onHandQuantity: ingredient.inventoryItem?.quantity ?? null,
    name: ingredient.name,
    unit: ingredient.unit,
    quantity: ingredient.quantity * multiplier,
  }));

  const nextAncestry = new Set(ancestry).add(recipeId);
  const nested = await Promise.all(
    recipe.components.map((component) =>
      expandRecipeIngredients(
        component.componentRecipeId,
        multiplier * component.quantity,
        nextAncestry,
        depth + 1,
      ),
    ),
  );

  return [...own, ...nested.flat()];
}
