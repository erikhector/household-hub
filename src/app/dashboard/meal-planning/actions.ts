"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { MEAL_TYPES, CUSTOM_RECIPE_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { fetchRecipeHtml, parseRecipeFromHtml, type FetchRecipeError } from "@/lib/recipe-import";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

// Exact copy of the pattern in src/app/dashboard/shopping-list/actions.ts —
// every ingredient (like every shopping list item) maps 1:1 to an
// InventoryItem, found-or-created by case-insensitive name match within the
// household. Duplicated rather than imported to keep this feature's
// actions.ts self-contained (it's owned by a different task/worktree).
async function findOrCreateInventoryItem(householdId: string, name: string) {
  const existing = await prisma.inventoryItem.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
  });
  if (existing) return existing;

  return prisma.inventoryItem.create({
    data: { householdId, name, category: "Uncategorized", quantity: 0, lowStockThreshold: 0 },
  });
}

type IngredientRow = { name: string; quantity: number; unit: string };

async function parseIngredientRows(
  formData: FormData,
  householdId: string,
): Promise<{ data: (IngredientRow & { inventoryItemId: string })[] } | { error: string }> {
  const names = formData.getAll("ingredientName").map((v) => String(v).trim());
  const quantities = formData.getAll("ingredientQuantity").map((v) => String(v).trim());
  const units = formData.getAll("ingredientUnit").map((v) => String(v).trim());

  const rows: IngredientRow[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: "Ingredient quantities must be greater than 0" };
    }

    rows.push({ name, quantity, unit: units[i] || "pcs" });
  }

  const data = await Promise.all(
    rows.map(async (row) => {
      const inventoryItem = await findOrCreateInventoryItem(householdId, row.name);
      return { ...row, inventoryItemId: inventoryItem.id };
    }),
  );

  return { data };
}

const recipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  instructions: z.string().trim().max(4000).optional(),
});

export async function createRecipeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ingredients = await parseIngredientRows(formData, household.id);
  if ("error" in ingredients) return { error: ingredients.error };

  await prisma.recipe.create({
    data: {
      householdId: household.id,
      name: parsed.data.name,
      instructions: parsed.data.instructions || null,
      ingredients: { create: ingredients.data },
    },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function updateRecipeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const recipeId = String(formData.get("recipeId") ?? "");
  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
  });
  if (!recipe) return { error: "Recipe not found" };

  const ingredients = await parseIngredientRows(formData, household.id);
  if ("error" in ingredients) return { error: ingredients.error };

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } }),
    prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        name: parsed.data.name,
        instructions: parsed.data.instructions || null,
        ingredients: { create: ingredients.data },
      },
    }),
  ]);

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function deleteRecipeAction(recipeId: string) {
  const { household } = await requireHousehold();

  await prisma.recipe.deleteMany({
    where: { id: recipeId, householdId: household.id },
  });

  revalidatePath(MEAL_PLANNING_PATH);
}

const addEntrySchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid week"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  mealType: z.enum(MEAL_TYPES),
  recipeId: z.string().optional(),
  freeformName: z.string().trim().max(120).optional(),
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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { weekStartDate, date, mealType, recipeId, freeformName } = parsed.data;

  let linkedRecipeId: string | null = null;
  let freeformMealName: string | null = null;

  if (recipeId && recipeId !== CUSTOM_RECIPE_SENTINEL) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, householdId: household.id },
    });
    if (!recipe) return { error: "Recipe not found" };
    linkedRecipeId = recipe.id;
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

export type ImportedRecipeIngredient = { name: string; quantity: number; unit: string };
export type ImportRecipeState = ActionState & {
  recipe?: {
    name: string;
    instructions: string;
    ingredients: ImportedRecipeIngredient[];
  };
};

function importErrorMessage(
  error: FetchRecipeError,
  dict: Awaited<ReturnType<typeof getDictionary>>["mealPlanning"],
): string {
  switch (error) {
    case "invalidUrl":
      return dict.importErrorInvalidUrl;
    case "blockedHost":
      return dict.importErrorBlockedHost;
    case "tooLarge":
    case "tooManyRedirects":
    case "fetchFailed":
    default:
      return dict.importErrorFetchFailed;
  }
}

// Fetches a user-supplied recipe URL server-side and extracts its
// schema.org/Recipe JSON-LD to pre-fill RecipeFormDialog's fields — never
// saves anything itself; the user still reviews and submits
// createRecipeAction/updateRecipeAction. requireHousehold() just confirms
// the caller is an authenticated member of a household (this action doesn't
// read/write anything household-scoped), matching the rule that every
// action in this file re-derives its caller from the session rather than
// trusting the client. See src/lib/recipe-import.ts for the SSRF-guarding
// fetch and the JSON-LD parsing.
export async function importRecipeFromUrlAction(
  _prevState: ImportRecipeState,
  formData: FormData,
): Promise<ImportRecipeState> {
  await requireHousehold();
  const dict = await getDictionary();

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: dict.mealPlanning.importErrorInvalidUrl };

  const fetched = await fetchRecipeHtml(url);
  if (!fetched.ok) return { error: importErrorMessage(fetched.error, dict.mealPlanning) };

  const recipe = parseRecipeFromHtml(fetched.html);
  if (!recipe) return { error: dict.mealPlanning.importErrorNoRecipeFound };

  return { recipe };
}
