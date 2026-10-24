import { prisma } from "@/lib/prisma";

// UX-136: what the overview needs to decide which sample-data card to show.
// Kept out of src/lib/actions/sample-data.ts because a "use server" file
// exposes every export as a callable endpoint, and this is only a read.
//
// `hasSample`: any seeded row is still there. Otherwise `isEmpty`: the
// household has none of the kinds of data the sample seeds, so offering it
// can't bury real rows. Counts only, all scoped to the household.
export async function loadSampleDataState(householdId: string): Promise<{ hasSample: boolean; isEmpty: boolean }> {
  const tagged = { not: null } as const;
  const sampleCounts = await Promise.all([
    prisma.inventoryItem.count({ where: { householdId, sample: tagged } }),
    prisma.shoppingList.count({ where: { householdId, sample: tagged } }),
    prisma.recipe.count({ where: { householdId, sample: tagged } }),
    prisma.mealPlanEntry.count({ where: { sample: tagged, mealPlan: { householdId } } }),
    prisma.householdTask.count({ where: { householdId, sample: tagged } }),
  ]);
  if (sampleCounts.some((n) => n > 0)) return { hasSample: true, isEmpty: false };

  const totals = await Promise.all([
    prisma.inventoryItem.count({ where: { householdId } }),
    prisma.shoppingList.count({ where: { householdId } }),
    prisma.recipe.count({ where: { householdId } }),
    prisma.mealPlanEntry.count({ where: { mealPlan: { householdId } } }),
    prisma.householdTask.count({ where: { householdId } }),
  ]);
  return { hasSample: false, isEmpty: totals.every((n) => n === 0) };
}
