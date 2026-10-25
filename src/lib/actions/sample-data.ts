"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildSampleData } from "@/lib/sample-data";

// UX-136: "Try with sample data" / "Clear sample data" on the overview. See
// src/lib/sample-data.ts for what is seeded and how it is tagged. Both are
// click actions on a plain form, and neither takes anything from the client:
// the household comes from the session, and the copy from the viewer's locale.

/** Everything the overview, planner and lists show, so a seed or a clear is visible on the next navigation. */
function revalidateSampleSurfaces() {
  revalidatePath("/dashboard", "layout");
}

export async function seedSampleDataAction(): Promise<void> {
  const { household } = await requireHousehold();
  const householdId = household.id;

  // Only ever on a household with none of the seeded kinds of data, so a
  // stale tab or a double tap can't pile a second copy onto a real one.
  const existing = await Promise.all([
    prisma.inventoryItem.count({ where: { householdId } }),
    prisma.shoppingList.count({ where: { householdId } }),
    prisma.recipe.count({ where: { householdId } }),
    prisma.mealPlanEntry.count({ where: { mealPlan: { householdId } } }),
    prisma.householdTask.count({ where: { householdId } }),
  ]);
  if (existing.some((n) => n > 0)) {
    revalidateSampleSurfaces();
    return;
  }

  const dict = await getDictionary();
  const data = buildSampleData(dict.dashboard.sampleData.content, new Date());

  await prisma.$transaction([
    prisma.inventoryItem.createMany({ data: data.inventory.map((row) => ({ ...row, householdId })) }),
    prisma.shoppingList.create({
      data: {
        householdId,
        name: data.list.name,
        sample: data.sample,
        // The household has no lists yet, so this one is the default.
        isDefault: true,
        items: { create: data.list.items },
      },
    }),
    ...data.recipes.map(({ ingredients, ...recipe }) =>
      prisma.recipe.create({
        data: { ...recipe, householdId, ingredients: { create: ingredients } },
      }),
    ),
    // The week's plan row is only tagged when this creates it; an existing
    // (empty) plan for that week is kept on clear, only its entries go.
    prisma.mealPlan.upsert({
      where: { householdId_weekStartDate: { householdId, weekStartDate: data.weekStartDate } },
      create: {
        householdId,
        weekStartDate: data.weekStartDate,
        sample: data.sample,
        entries: { create: data.dinners },
      },
      update: { entries: { create: data.dinners } },
    }),
    prisma.householdTask.createMany({ data: data.tasks.map((row) => ({ ...row, householdId })) }),
  ]);

  revalidateSampleSurfaces();
}

export async function clearSampleDataAction(): Promise<void> {
  const { household } = await requireHousehold();
  const householdId = household.id;
  const tagged = { not: null } as const;

  // Children first, each scoped to the household and to the tag. A parent
  // (list, week plan) that has since gained a row of the person's own stays,
  // untagged, so what they added is never lost with the sample around it.
  await prisma.$transaction([
    prisma.shoppingListItem.deleteMany({ where: { sample: tagged, shoppingList: { householdId } } }),
    prisma.mealPlanEntry.deleteMany({ where: { sample: tagged, mealPlan: { householdId } } }),
    prisma.shoppingList.deleteMany({ where: { householdId, sample: tagged, items: { none: {} } } }),
    prisma.shoppingList.updateMany({ where: { householdId, sample: tagged }, data: { sample: null } }),
    prisma.mealPlan.deleteMany({ where: { householdId, sample: tagged, entries: { none: {} } } }),
    prisma.mealPlan.updateMany({ where: { householdId, sample: tagged }, data: { sample: null } }),
    prisma.recipe.deleteMany({ where: { householdId, sample: tagged } }),
    prisma.householdTask.deleteMany({ where: { householdId, sample: tagged } }),
    prisma.inventoryItem.deleteMany({ where: { householdId, sample: tagged } }),
  ]);

  revalidateSampleSurfaces();
}
