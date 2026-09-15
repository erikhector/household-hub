"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { toFriendlyError } from "@/lib/actions/errors";
import type { ActionState } from "@/lib/actions/auth";
import { NEW_SHOPPING_LIST_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { computeMissingIngredients, type IngredientNeed } from "@/app/dashboard/meal-planning/missing-ingredients";
import { computeCookedIngredients, type CookedIngredientNeed } from "@/app/dashboard/meal-planning/cooked-ingredients";
import { expandRecipeIngredients } from "@/app/dashboard/meal-planning/recipe-expansion";
import type { MissingIngredientData, CookedIngredientData } from "@/components/meal-planning/types";
import { recordOutOfStockTransition, recordRestockTransition } from "@/lib/notifications";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";
const WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Exact copy of the pattern in src/app/dashboard/shopping-list/actions.ts —
// every ingredient (like every shopping list item) maps 1:1 to an
// InventoryItem, found-or-created by case-insensitive name match within the
// household. Duplicated (rather than imported) here and in
// recipe-actions.ts to keep each of this feature's action files
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

// Mirrors recipe-actions.ts's identical bound on ingredient rows — kept as
// its own copy here (rather than imported) for the same self-containment
// reason as findOrCreateInventoryItem above.
const MAX_INGREDIENT_QUANTITY = 1_000_000;

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
        select: { recipeId: true, portions: true, recipe: { select: { servings: true } } },
      },
    },
  });

  if (!plan || plan.entries.length === 0) {
    return { items: [] };
  }

  // Each entry's recipeId is expanded recursively — its own ingredients plus
  // every ingredient contributed by its sub-recipes (see RecipeComponent in
  // schema.prisma) — into one flat list. See recipe-expansion.ts.
  //
  // The multiplier scales the recipe's as-written ingredient quantities down
  // (or up) to how many portions this specific entry is cooking — see
  // MealPlanEntry.portions' doc comment in schema.prisma. Two entries of the
  // same 4-portion recipe each cooking 2 portions (e.g. lasagna for Thursday
  // dinner and Friday lunch) therefore total 1 full batch, not 2.
  const expanded = (
    await Promise.all(
      plan.entries.map((entry) => {
        const multiplier = entry.portions / (entry.recipe?.servings || entry.portions || 1);
        return expandRecipeIngredients(entry.recipeId!, multiplier, new Set());
      }),
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
        onHandUnit: ingredient.onHandUnit,
      };
    }
    const loose = looseByName.get(ingredient.name.toLowerCase());
    return {
      key: loose ? loose.id : `name:${ingredient.name.toLowerCase()}`,
      name: loose?.name ?? ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity,
      onHandQuantity: loose?.quantity ?? 0,
      onHandUnit: loose?.unit ?? null,
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
        unit: row.unit,
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

// --- Mark meal as cooked → inventory decrement ------------------------------
//
// Unlike the shopping-list bridge above (which only ever proposes additions),
// this actually mutates inventory quantities, so it's scoped to a single
// MealPlanEntry rather than a whole week, and is confirm-then-commit rather
// than automatic — see "Mark meal as cooked → inventory decrement" in
// REQUIREMENTS.md for why (competitor research, and the lack of a unit-
// conversion layer here making a silent auto-decrement risky).

async function loadCookableEntry(entryId: string, householdId: string) {
  return prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId } },
    select: {
      id: true,
      recipeId: true,
      portions: true,
      consumedAt: true,
      recipe: { select: { servings: true } },
    },
  });
}

// Read-only preview — no rows are written until markMealEntryCookedAction
// below is called. Reuses the exact same expansion/scaling/loose-match logic
// as previewMissingIngredientsAction, but (unlike that action) drops any
// ingredient that doesn't resolve to an existing InventoryItem, since there's
// nothing to decrement for it.
export async function previewCookedIngredientsAction(
  entryId: string,
): Promise<{ items: CookedIngredientData[] } | { error: string }> {
  const { household } = await requireHousehold();

  const entry = await loadCookableEntry(entryId, household.id);
  if (!entry) return { error: "Meal not found" };
  if (!entry.recipeId) return { error: "No recipe linked to this meal" };

  const multiplier = entry.portions / (entry.recipe?.servings || entry.portions || 1);
  const expanded = await expandRecipeIngredients(entry.recipeId, multiplier, new Set());

  // Same fallback as previewMissingIngredientsAction: an ingredient's
  // inventoryItemId is normally always set (find-or-create-linked at
  // recipe-save time), but the relation is `onDelete: SetNull`, so a
  // since-deleted inventory item can leave one unlinked.
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

  const needs: CookedIngredientNeed[] = [];
  for (const ingredient of expanded) {
    if (ingredient.inventoryItemId) {
      needs.push({
        inventoryItemId: ingredient.inventoryItemId,
        name: ingredient.inventoryItemName ?? ingredient.name,
        onHandQuantity: ingredient.onHandQuantity ?? 0,
        onHandUnit: ingredient.onHandUnit ?? "pcs",
        requiredQuantity: ingredient.quantity,
        requiredUnit: ingredient.unit,
      });
      continue;
    }
    const loose = looseByName.get(ingredient.name.toLowerCase());
    // Nothing to decrement for an ingredient with no matching inventory
    // item — unlike the shopping-list bridge, this can't propose creating
    // one, so it's simply dropped from the review list.
    if (!loose) continue;
    needs.push({
      inventoryItemId: loose.id,
      name: loose.name,
      onHandQuantity: loose.quantity,
      onHandUnit: loose.unit,
      requiredQuantity: ingredient.quantity,
      requiredUnit: ingredient.unit,
    });
  }

  return { items: computeCookedIngredients(needs) };
}

export async function markMealEntryCookedAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const entryId = String(formData.get("entryId") ?? "");
  const entry = await loadCookableEntry(entryId, household.id);
  if (!entry) return { error: "Meal not found" };
  // Idempotent no-op — a stale button re-click or a double-submit shouldn't
  // decrement inventory twice, mirroring RecurringTemplateAck's
  // repeat-click idempotency elsewhere in this app.
  if (entry.consumedAt) return {};

  const itemIds = formData.getAll("itemId").map((v) => String(v).trim());
  const quantities = formData.getAll("itemQuantity").map((v) => Number(v));

  const rows = itemIds
    .map((itemId, i) => ({ itemId, quantity: quantities[i] }))
    .filter(
      (row) =>
        row.itemId &&
        Number.isFinite(row.quantity) &&
        row.quantity >= 0 &&
        row.quantity <= MAX_INGREDIENT_QUANTITY,
    );

  try {
    await prisma.$transaction(async (tx) => {
      if (rows.length > 0) {
        const items = await tx.inventoryItem.findMany({
          where: { id: { in: rows.map((r) => r.itemId) }, householdId: household.id },
        });
        const itemsById = new Map(items.map((item) => [item.id, item]));

        for (const row of rows) {
          const item = itemsById.get(row.itemId);
          if (!item) continue; // not this household's item — silently skip, mirrors bulkUpdateFieldAction
          const nextQuantity = Math.max(0, item.quantity - row.quantity);
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { quantity: nextQuantity, updatedByUserId: userId },
          });
          await recordOutOfStockTransition(tx, household.id, item.id, item.quantity, nextQuantity);
        }
      }

      await tx.mealPlanEntry.update({
        where: { id: entry.id },
        data: { consumedAt: new Date() },
      });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

// --- Undo mark-as-cooked (short-lived toast action) --------------------------
//
// Reverses the exact decrement markMealEntryCookedAction just applied.
// Deliberately not a permanent unmark control — REQUIREMENTS.md's "No undo"
// rationale for this feature still holds (a meal plan can diverge from what
// was actually cooked, and a stale undo could drift inventory the other
// way). This only covers the fat-finger case: MarkCookedDialog surfaces it
// as an "Undo" action on the confirmation toast for a few seconds, then it's
// gone and the entry is final again, same as before.
export async function undoMarkMealEntryCookedAction(
  entryId: string,
  rows: { itemId: string; quantity: number }[],
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true, consumedAt: true },
  });
  if (!entry) return { error: "Meal not found" };
  // Idempotent no-op — a stale/double-clicked undo shouldn't credit
  // inventory back twice, mirroring markMealEntryCookedAction's own guard.
  if (!entry.consumedAt) return {};

  const validRows = rows.filter(
    (row) =>
      row.itemId &&
      Number.isFinite(row.quantity) &&
      row.quantity >= 0 &&
      row.quantity <= MAX_INGREDIENT_QUANTITY,
  );

  try {
    await prisma.$transaction(async (tx) => {
      if (validRows.length > 0) {
        const items = await tx.inventoryItem.findMany({
          where: { id: { in: validRows.map((r) => r.itemId) }, householdId: household.id },
        });
        const itemsById = new Map(items.map((item) => [item.id, item]));

        for (const row of validRows) {
          const item = itemsById.get(row.itemId);
          if (!item) continue; // not this household's item — silently skip, mirrors markMealEntryCookedAction
          const nextQuantity = item.quantity + row.quantity;
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { quantity: nextQuantity, updatedByUserId: userId },
          });
          await recordRestockTransition(
            tx,
            household.id,
            item.id,
            item.quantity,
            item.lowStockThreshold,
            nextQuantity,
            item.lowStockThreshold,
          );
        }
      }

      await tx.mealPlanEntry.update({
        where: { id: entry.id },
        data: { consumedAt: null },
      });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}
