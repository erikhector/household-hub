"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import {
  MEAL_TYPES,
  CUSTOM_RECIPE_SENTINEL,
  NEW_SHOPPING_LIST_SENTINEL,
} from "@/app/dashboard/meal-planning/meal-types";
import { computeMissingIngredients, type IngredientNeed } from "@/app/dashboard/meal-planning/missing-ingredients";
import type { MissingIngredientData } from "@/components/meal-planning/types";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";
const WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
      entries: {
        where: { recipeId: { not: null } },
        include: {
          recipe: { include: { ingredients: { include: { inventoryItem: true } } } },
        },
      },
    },
  });

  if (!plan || plan.entries.length === 0) {
    return { items: [] };
  }

  // Every ingredient is normally linked to an InventoryItem at recipe-save
  // time (see "Ingredient → inventory linking" in REQUIREMENTS.md), but the
  // relation is `onDelete: SetNull`, so a since-deleted inventory item can
  // leave an ingredient unlinked. Fall back to a case-insensitive name match
  // against the household's current inventory for those, same identity rule
  // `findOrCreateInventoryItem` uses everywhere else.
  const looseNames = new Set<string>();
  for (const entry of plan.entries) {
    for (const ingredient of entry.recipe?.ingredients ?? []) {
      if (!ingredient.inventoryItem) looseNames.add(ingredient.name.toLowerCase());
    }
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

  const needs: IngredientNeed[] = [];
  for (const entry of plan.entries) {
    for (const ingredient of entry.recipe?.ingredients ?? []) {
      const resolved = ingredient.inventoryItem ?? looseByName.get(ingredient.name.toLowerCase()) ?? null;
      needs.push({
        key: resolved ? resolved.id : `name:${ingredient.name.toLowerCase()}`,
        name: resolved?.name ?? ingredient.name,
        unit: ingredient.unit,
        quantity: ingredient.quantity,
        onHandQuantity: resolved?.quantity ?? 0,
      });
    }
  }

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
