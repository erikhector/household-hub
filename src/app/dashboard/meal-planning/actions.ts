"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import {
  MEAL_TYPES,
  CUSTOM_RECIPE_SENTINEL,
  NEW_SHOPPING_LIST_SENTINEL,
} from "@/app/dashboard/meal-planning/meal-types";
import { fetchRecipeHtml, parseRecipeFromHtml, type FetchRecipeError } from "@/lib/recipe-import";
import { computeMissingIngredients, type IngredientNeed } from "@/app/dashboard/meal-planning/missing-ingredients";
import { wouldCreateCycle } from "@/app/dashboard/meal-planning/recipe-components";
import { expandRecipeIngredients } from "@/app/dashboard/meal-planning/recipe-expansion";
import type { MissingIngredientData } from "@/components/meal-planning/types";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";
const WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

type MealPlanningDict = Awaited<ReturnType<typeof getDictionary>>["mealPlanning"];

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

// --- Meal-plan → shopping-list bridge ---------------------------------------
//
// Diffs a planned week's recipe ingredients against current inventory and
// lets the user push the shortfall onto a shopping list. Scoped to the whole
// visible week (not a single day) — the simplest option per the task spec,
// and it matches the competitor pattern (Mealime/Paprika/Plan to
// Eat/Whisk all diff a full week at once). Freeform meal entries have no
// `recipeId` and therefore no ingredients, so they're naturally excluded by
// the `recipeId: { not: null }` filter below.
//
// This is a read-only preview — no rows are written — so the user can review
// suggested quantities before anything is committed via
// addMissingIngredientsToShoppingListAction below.
export async function previewMissingIngredientsAction(
  weekStartKey: string,
): Promise<{ items: MissingIngredientData[] } | { error: string }> {
  const { household } = await requireHousehold();

  if (!WEEK_KEY_RE.test(weekStartKey)) {
    return { error: "Invalid week" };
  }

  const weekStartDate = new Date(`${weekStartKey}T00:00:00.000Z`);

  const plan = await prisma.mealPlan.findFirst({
    where: { householdId: household.id, weekStartDate },
    include: {
      entries: { where: { recipeId: { not: null } }, select: { recipeId: true } },
    },
  });

  if (!plan || plan.entries.length === 0) {
    return { items: [] };
  }

  // Each entry's recipeId is expanded recursively — its own ingredients plus
  // every ingredient contributed by its sub-recipes (see RecipeComponent in
  // schema.prisma) — into one flat list. See recipe-expansion.ts.
  const expanded = (
    await Promise.all(
      plan.entries.map((entry) => expandRecipeIngredients(entry.recipeId!, 1, new Set())),
    )
  ).flat();

  // Every ingredient is normally linked to an InventoryItem at recipe-save
  // time (see "Ingredient → inventory linking" in REQUIREMENTS.md), but the
  // relation is `onDelete: SetNull`, so a since-deleted inventory item can
  // leave an ingredient unlinked. Fall back to a case-insensitive name match
  // against the household's current inventory for those, same identity rule
  // `findOrCreateInventoryItem` uses everywhere else.
  const looseNames = new Set<string>();
  for (const ingredient of expanded) {
    if (!ingredient.inventoryItemId) looseNames.add(ingredient.name.toLowerCase());
  }
  const looseMatches =
    looseNames.size > 0
      ? await prisma.inventoryItem.findMany({ where: { householdId: household.id } })
      : [];
  const looseByName = new Map(
    looseMatches
      .filter((item) => looseNames.has(item.name.toLowerCase()))
      .map((item) => [item.name.toLowerCase(), item]),
  );

  const needs: IngredientNeed[] = expanded.map((ingredient) => {
    if (ingredient.inventoryItemId) {
      return {
        key: ingredient.inventoryItemId,
        name: ingredient.inventoryItemName ?? ingredient.name,
        unit: ingredient.unit,
        quantity: ingredient.quantity,
        onHandQuantity: ingredient.onHandQuantity ?? 0,
      };
    }
    const loose = looseByName.get(ingredient.name.toLowerCase());
    return {
      key: loose ? loose.id : `name:${ingredient.name.toLowerCase()}`,
      name: loose?.name ?? ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity,
      onHandQuantity: loose?.quantity ?? 0,
    };
  });

  // Only ingredients the household doesn't already have enough of are
  // proposed — never an item that's already sufficiently stocked. This
  // aggregate/diff/filter/sort step is pure — see missing-ingredients.ts.
  return { items: computeMissingIngredients(needs) };
}

const addMissingIngredientsSchema = z.object({
  targetListId: z.string().min(1, "Choose a shopping list"),
  newListName: z.string().trim().max(120).optional(),
});

export async function addMissingIngredientsToShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = addMissingIngredientsSchema.safeParse({
    targetListId: formData.get("targetListId"),
    newListName: formData.get("newListName") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const names = formData.getAll("itemName").map((v) => String(v).trim());
  const quantities = formData.getAll("itemQuantity").map((v) => Number(v));
  const units = formData.getAll("itemUnit").map((v) => String(v).trim());

  const rows = names
    .map((name, i) => ({ name, quantity: quantities[i], unit: units[i] || "pcs" }))
    .filter((row) => row.name && Number.isFinite(row.quantity) && row.quantity > 0);

  if (rows.length === 0) {
    return { error: "Select at least one ingredient to add" };
  }

  let listId: string;
  if (parsed.data.targetListId === NEW_SHOPPING_LIST_SENTINEL) {
    const dict = await getDictionary();
    const list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name:
          parsed.data.newListName ||
          `${dict.shoppingList.defaultNamePrefix} — ${new Date().toLocaleDateString()}`,
      },
    });
    listId = list.id;
  } else {
    const list = await prisma.shoppingList.findFirst({
      where: { id: parsed.data.targetListId, householdId: household.id, status: "ACTIVE" },
    });
    if (!list) return { error: "Shopping list not found" };
    listId = list.id;
  }

  // Mirrors generateFromLowStockAction's dedupe: don't add a second row for
  // an inventory item that's already pending (unpurchased) on the target
  // list — the user can adjust the quantity already there instead.
  const alreadyOnList = await prisma.shoppingListItem.findMany({
    where: { shoppingListId: listId, purchased: false, inventoryItemId: { not: null } },
    select: { inventoryItemId: true },
  });
  const alreadyOnListIds = new Set(alreadyOnList.map((i) => i.inventoryItemId));

  for (const row of rows) {
    const inventoryItem = await findOrCreateInventoryItem(household.id, row.name);
    if (alreadyOnListIds.has(inventoryItem.id)) continue;

    await prisma.shoppingListItem.create({
      data: {
        shoppingListId: listId,
        inventoryItemId: inventoryItem.id,
        name: row.name,
        quantity: row.quantity,
        addedAutomatically: true,
      },
    });
    alreadyOnListIds.add(inventoryItem.id);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  revalidatePath("/dashboard");

  return {};
}
