// GAP-49: the household's active meal-prep batches, for the Prep tab.
//
// Not a "use server" action: only the meal-planning page's server-side
// fetch calls it, same reasoning as cookable-recipes.ts staying a plain
// module. `cache()`-wrapped so the Prep tab and anything else on the same
// request (the dashboard card, the add-meal dialog's "From meal prep"
// source) share one query.
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { isActiveBatch } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import type { PreparedBatchData } from "@/components/meal-planning/types";

export const getActiveBatches = cache(async (householdId: string): Promise<PreparedBatchData[]> => {
  const batches = await prisma.preparedBatch.findMany({
    where: { householdId },
    include: {
      recipe: { select: { name: true } },
      cookedByMember: { select: { user: { select: { displayName: true } } } },
      // Only uneaten linked entries count: an emptied batch whose last
      // portions are still planned is tomorrow's dinner and stays on the
      // tab, but once every one of those meals is eaten the batch is done
      // and isActiveBatch drops it.
      _count: { select: { mealPlanEntries: { where: { consumedAt: null } } } },
    },
  });

  return (
    batches
      .filter((batch) => isActiveBatch(batch.remainingPortions, batch._count.mealPlanEntries))
      // Soonest eat-by first, so what has to be eaten next leads the tab; a
      // batch without a date can't go off on a known day, so it goes last.
      // Ties keep the oldest cook first.
      .sort((a, b) => {
        if (a.expiryDate && b.expiryDate) {
          const byExpiry = a.expiryDate.getTime() - b.expiryDate.getTime();
          if (byExpiry !== 0) return byExpiry;
        } else if (a.expiryDate) return -1;
        else if (b.expiryDate) return 1;
        return a.cookedAt.getTime() - b.cookedAt.getTime();
      })
      .map((batch) => ({
        id: batch.id,
        recipeId: batch.recipeId,
        recipeName: batch.recipe.name,
        totalPortions: batch.totalPortions,
        remainingPortions: batch.remainingPortions,
        cookedAt: batch.cookedAt.toISOString(),
        expiryDate: batch.expiryDate?.toISOString() ?? null,
        cookedByName: batch.cookedByMember?.user.displayName ?? null,
        plannedCount: batch._count.mealPlanEntries,
      }))
  );
});
