import { prisma } from "@/lib/prisma";

// GAP-46: how often and when each recipe was last cooked, read back from
// MealPlanEntry.consumedAt (set by "Mark as cooked"). One groupBy over the
// household's cooked entries, so the Recipes list pays a single query
// instead of one per recipe. A recipe never cooked has no key at all, which
// is what lets the row show nothing rather than "0 times".
export type RecipeCookedStats = { count: number; lastCookedAt: string };

export async function getRecipeCookedStats(householdId: string): Promise<Record<string, RecipeCookedStats>> {
  const groups = await prisma.mealPlanEntry.groupBy({
    by: ["recipeId"],
    // A freeform entry has no recipe, and an entry not yet cooked has no
    // consumedAt; neither counts toward any recipe.
    where: { mealPlan: { householdId }, recipeId: { not: null }, consumedAt: { not: null } },
    _count: { _all: true },
    _max: { consumedAt: true },
  });
  const stats: Record<string, RecipeCookedStats> = {};
  for (const group of groups) {
    if (group.recipeId === null || group._max.consumedAt === null) continue;
    stats[group.recipeId] = { count: group._count._all, lastCookedAt: group._max.consumedAt.toISOString() };
  }
  return stats;
}
