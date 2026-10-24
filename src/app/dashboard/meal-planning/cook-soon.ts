// GAP-51 "Cook soon": the rules for the pinned shelf at the top of the
// Recipes tab. A plain module (no "use server") so the planner and cooking
// actions can share the auto-clear and the client can share the ordering.

// The slice of a Prisma client (or transaction client) the clear needs.
type RecipeUpdater = {
  recipe: {
    updateMany: (args: {
      where: { id: string; householdId: string; cookSoonAt: { not: null } };
      data: { cookSoonAt: null };
    }) => Promise<unknown>;
  };
};

/**
 * Takes a recipe off the Cook soon shelf once it has a date or has been
 * cooked: the shelf is for "I want to make this soon" with no day picked, so
 * a recipe that now has one (or is done) would only be stale there. A null
 * `recipeId` (a freeform meal) is a no-op, and so is a recipe that wasn't on
 * the shelf: the `cookSoonAt: { not: null }` filter means nothing is written
 * for it. Scoped by household like every other recipe query, so an id from
 * another household can never be touched.
 */
export async function clearCookSoon(
  client: RecipeUpdater,
  householdId: string,
  recipeId: string | null | undefined,
): Promise<void> {
  if (!recipeId) return;
  await client.recipe.updateMany({
    where: { id: recipeId, householdId, cookSoonAt: { not: null } },
    data: { cookSoonAt: null },
  });
}

/**
 * Splits the (already filtered) recipe list into the pinned shelf and the
 * rest. The shelf is ordered by when each recipe was added, oldest first, so
 * the one that has waited longest is on top. `rest` keeps the incoming
 * order (alphabetical from the page query), and a recipe is in exactly one
 * of the two.
 */
export function splitCookSoon<T extends { cookSoonAt: string | null }>(
  recipes: T[],
): { shelf: T[]; rest: T[] } {
  const shelf = recipes
    .filter((recipe) => recipe.cookSoonAt !== null)
    .sort((a, b) => Date.parse(a.cookSoonAt as string) - Date.parse(b.cookSoonAt as string));
  const rest = recipes.filter((recipe) => recipe.cookSoonAt === null);
  return { shelf, rest };
}
