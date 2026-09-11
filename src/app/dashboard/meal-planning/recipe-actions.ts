"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import { fetchRecipeHtml, parseRecipeFromHtml, type FetchRecipeError } from "@/lib/recipe-import";
import { wouldCreateCycle } from "@/app/dashboard/meal-planning/recipe-components";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

type MealPlanningDict = Awaited<ReturnType<typeof getDictionary>>["mealPlanning"];

// Exact copy of the pattern in src/app/dashboard/shopping-list/actions.ts —
// every ingredient (like every shopping list item) maps 1:1 to an
// InventoryItem, found-or-created by case-insensitive name match within the
// household. Duplicated (rather than imported) here and in
// cooking-actions.ts to keep each of this feature's action files
// self-contained.
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

// Mirrors recipeSchema's own bounds (name: 120, kept modest since ingredient
// names/units are always short words/phrases, never freeform prose) — every
// row is validated here rather than via a zod array schema because rows
// arrive as parallel FormData.getAll() arrays, not a single JSON payload.
const MAX_INGREDIENT_NAME_LENGTH = 120;
const MAX_INGREDIENT_UNIT_LENGTH = 20;
const MAX_INGREDIENT_QUANTITY = 1_000_000;

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
    if (name.length > MAX_INGREDIENT_NAME_LENGTH) {
      return { error: `Ingredient names must be ${MAX_INGREDIENT_NAME_LENGTH} characters or fewer` };
    }

    const unit = units[i] || "pcs";
    if (unit.length > MAX_INGREDIENT_UNIT_LENGTH) {
      return { error: `Ingredient units must be ${MAX_INGREDIENT_UNIT_LENGTH} characters or fewer` };
    }

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_INGREDIENT_QUANTITY) {
      return { error: "Ingredient quantities must be greater than 0" };
    }

    rows.push({ name, quantity, unit });
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
  servings: z.coerce.number().int().min(1, "Servings must be at least 1").max(1_000),
});

type ComponentRow = { componentRecipeId: string; quantity: number };

// Mirrors parseIngredientRows: rows arrive as parallel FormData.getAll()
// arrays. `parentRecipeId` is undefined for a brand-new recipe — it can't
// be anyone's descendant yet, so the cycle check is skipped entirely rather
// than trivially passing on every candidate.
const MAX_COMPONENT_QUANTITY = 1_000;

async function parseComponentRows(
  formData: FormData,
  householdId: string,
  parentRecipeId: string | undefined,
  dict: MealPlanningDict,
): Promise<{ data: ComponentRow[] } | { error: string }> {
  const ids = formData.getAll("componentRecipeId").map((v) => String(v).trim());
  const quantities = formData.getAll("componentQuantity").map((v) => String(v).trim());

  const seen = new Set<string>();
  const rows: ComponentRow[] = [];
  for (let i = 0; i < ids.length; i++) {
    const componentRecipeId = ids[i];
    if (!componentRecipeId || seen.has(componentRecipeId)) continue;
    seen.add(componentRecipeId);

    const quantity = Number(quantities[i] || "1");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_COMPONENT_QUANTITY) {
      return { error: dict.componentQuantityError };
    }

    const componentRecipe = await prisma.recipe.findFirst({
      where: { id: componentRecipeId, householdId },
      select: { id: true },
    });
    if (!componentRecipe) return { error: dict.componentNotFoundError };

    if (parentRecipeId && (await wouldCreateCycle(parentRecipeId, componentRecipeId))) {
      return { error: dict.componentCycleError };
    }

    rows.push({ componentRecipeId, quantity });
  }

  return { data: rows };
}

export async function createRecipeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    servings: formData.get("servings") || 4,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ingredients = await parseIngredientRows(formData, household.id);
  if ("error" in ingredients) return { error: ingredients.error };

  const components = await parseComponentRows(formData, household.id, undefined, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  await prisma.recipe.create({
    data: {
      householdId: household.id,
      name: parsed.data.name,
      instructions: parsed.data.instructions || null,
      servings: parsed.data.servings,
      ingredients: { create: ingredients.data },
      components: { create: components.data },
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
  const dict = await getDictionary();

  const recipeId = String(formData.get("recipeId") ?? "");
  const parsed = recipeSchema.safeParse({
    name: formData.get("name"),
    instructions: formData.get("instructions") || undefined,
    servings: formData.get("servings") || 4,
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

  const components = await parseComponentRows(formData, household.id, recipe.id, dict.mealPlanning);
  if ("error" in components) return { error: components.error };

  await prisma.$transaction([
    prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } }),
    prisma.recipeComponent.deleteMany({ where: { parentRecipeId: recipe.id } }),
    prisma.recipe.update({
      where: { id: recipe.id },
      data: {
        name: parsed.data.name,
        instructions: parsed.data.instructions || null,
        servings: parsed.data.servings,
        ingredients: { create: ingredients.data },
        components: { create: components.data },
      },
    }),
  ]);

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function deleteRecipeAction(recipeId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = await getDictionary();

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, householdId: household.id },
  });
  if (!recipe) return {};

  // Blocking here (rather than letting the RESTRICT foreign key throw) gives
  // a clear, translated error naming the recipe that still depends on it —
  // see RecipeComponent's doc comment in schema.prisma.
  const usedAsComponent = await prisma.recipeComponent.findFirst({
    where: { componentRecipeId: recipe.id },
    include: { parentRecipe: { select: { name: true } } },
  });
  if (usedAsComponent) {
    return {
      error: format(dict.mealPlanning.deleteRecipeInUseError, {
        recipeName: usedAsComponent.parentRecipe.name,
      }),
    };
  }

  await prisma.recipe.delete({ where: { id: recipe.id } });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export type ImportedRecipeIngredient = { name: string; quantity: number; unit: string };
export type ImportRecipeState = ActionState & {
  recipe?: {
    name: string;
    instructions: string;
    ingredients: ImportedRecipeIngredient[];
  };
};

function importErrorMessage(error: FetchRecipeError, dict: MealPlanningDict): string {
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
// action in this feature re-derives its caller from the session rather than
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
