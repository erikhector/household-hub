import { prisma } from "@/lib/prisma";

// UX-136: what the overview needs to decide which sample-data card to show.
// Kept out of src/lib/actions/sample-data.ts because a "use server" file
// exposes every export as a callable endpoint, and this is only a read.
//
// `hasSample`: any seeded row is still there. Otherwise `isEmpty`: the
// household has none of the kinds of data the sample seeds, so offering it
// can't bury real rows. Existence probes only (`findFirst` selecting the id,
// which stops at the first hit, unlike a `count` that walks every row), all
// scoped to the household.
export async function loadSampleDataState(householdId: string): Promise<{ hasSample: boolean; isEmpty: boolean }> {
  const tagged = { not: null } as const;
  const select = { id: true } as const;
  const sampleRows = await Promise.all([
    prisma.inventoryItem.findFirst({ where: { householdId, sample: tagged }, select }),
    prisma.shoppingList.findFirst({ where: { householdId, sample: tagged }, select }),
    prisma.recipe.findFirst({ where: { householdId, sample: tagged }, select }),
    prisma.mealPlanEntry.findFirst({ where: { sample: tagged, mealPlan: { householdId } }, select }),
    prisma.householdTask.findFirst({ where: { householdId, sample: tagged }, select }),
  ]);
  if (sampleRows.some(Boolean)) return { hasSample: true, isEmpty: false };

  const anyRows = await Promise.all([
    prisma.inventoryItem.findFirst({ where: { householdId }, select }),
    prisma.shoppingList.findFirst({ where: { householdId }, select }),
    prisma.recipe.findFirst({ where: { householdId }, select }),
    prisma.mealPlanEntry.findFirst({ where: { mealPlan: { householdId } }, select }),
    prisma.householdTask.findFirst({ where: { householdId }, select }),
  ]);
  return { hasSample: false, isEmpty: anyRows.every((row) => !row) };
}
