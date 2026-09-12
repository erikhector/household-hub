"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { MEAL_TYPES, CUSTOM_RECIPE_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

const addEntrySchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid week"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  mealType: z.enum(MEAL_TYPES),
  recipeId: z.string().optional(),
  freeformName: z.string().trim().max(120).optional(),
  // How many portions of the recipe this slot is for — see
  // MealPlanEntry.portions' doc comment in schema.prisma. Optional because a
  // freeform entry has no recipe to scale; when omitted for a recipe entry,
  // addMealEntryAction below falls back to that recipe's own `servings` (i.e.
  // "one full recipe"), matching pre-portions behavior.
  portions: z.coerce.number().int().min(1, "Portions must be at least 1").max(1_000).optional(),
});

export async function addMealEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = addEntrySchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    date: formData.get("date"),
    mealType: formData.get("mealType"),
    recipeId: formData.get("recipeId") || undefined,
    freeformName: formData.get("freeformName") || undefined,
    portions: formData.get("portions") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { weekStartDate, date, mealType, recipeId, freeformName } = parsed.data;

  let linkedRecipeId: string | null = null;
  let freeformMealName: string | null = null;
  // Falls back to the recipe's own serving size (i.e. "one full recipe")
  // when the form doesn't send an explicit portions count.
  let portions = parsed.data.portions ?? 4;

  if (recipeId && recipeId !== CUSTOM_RECIPE_SENTINEL) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, householdId: household.id },
    });
    if (!recipe) return { error: "Recipe not found" };
    linkedRecipeId = recipe.id;
    portions = parsed.data.portions ?? recipe.servings;
  } else {
    if (!freeformName) return { error: "Choose a recipe or enter a meal name" };
    freeformMealName = freeformName;
  }

  const plan = await prisma.mealPlan.upsert({
    where: {
      householdId_weekStartDate: {
        householdId: household.id,
        weekStartDate: new Date(`${weekStartDate}T00:00:00.000Z`),
      },
    },
    update: {},
    create: {
      householdId: household.id,
      weekStartDate: new Date(`${weekStartDate}T00:00:00.000Z`),
    },
  });

  await prisma.mealPlanEntry.create({
    data: {
      mealPlanId: plan.id,
      date: new Date(`${date}T00:00:00.000Z`),
      mealType,
      recipeId: linkedRecipeId,
      freeformName: freeformMealName,
      portions,
    },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function deleteMealEntryAction(entryId: string) {
  const { household } = await requireHousehold();

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true },
  });
  if (!entry) return;

  await prisma.mealPlanEntry.delete({ where: { id: entry.id } });

  revalidatePath(MEAL_PLANNING_PATH);
}
