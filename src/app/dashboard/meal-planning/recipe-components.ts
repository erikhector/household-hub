// Cycle-safety for recipe composition (see AGENTS.md's meal-planning
// section / RecipeComponent's doc comment in schema.prisma). Split out of
// actions.ts (a "use server" file, which may only export async functions)
// so it's unit-testable by mocking @/lib/prisma directly — mirrors
// missing-ingredients.ts's reason for living in its own module.
import { prisma } from "@/lib/prisma";

// Recipe boxes are household-sized, not catalog-sized — this just guards
// against a runaway loop if a cycle ever slipped past assertNoCycle (e.g. a
// bug, or a row edited directly in the database).
const MAX_TRAVERSAL_STEPS = 500;

// BFS over the "contains" edges (RecipeComponent.parentRecipeId ->
// componentRecipeId), starting at `recipeId`. Returns every recipe id
// reachable — i.e. everything `recipeId` includes, directly or through its
// own sub-recipes' sub-recipes, etc. (including `recipeId` itself, as the
// starting point).
export async function getDescendantRecipeIds(recipeId: string): Promise<Set<string>> {
  const visited = new Set<string>([recipeId]);
  let frontier = [recipeId];
  let steps = 0;

  while (frontier.length > 0 && steps < MAX_TRAVERSAL_STEPS) {
    steps++;
    const edges = await prisma.recipeComponent.findMany({
      where: { parentRecipeId: { in: frontier } },
      select: { componentRecipeId: true },
    });
    const next = edges.map((edge) => edge.componentRecipeId).filter((id) => !visited.has(id));
    for (const id of next) visited.add(id);
    frontier = next;
  }

  return visited;
}

// True if adding `componentRecipeId` as a sub-recipe of `parentRecipeId`
// would create a cycle: either a direct self-reference, or an indirect one
// where the component already (transitively) contains the parent.
export async function wouldCreateCycle(
  parentRecipeId: string,
  componentRecipeId: string,
): Promise<boolean> {
  if (parentRecipeId === componentRecipeId) return true;
  const descendants = await getDescendantRecipeIds(componentRecipeId);
  return descendants.has(parentRecipeId);
}
