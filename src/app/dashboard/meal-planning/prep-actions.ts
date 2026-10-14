"use server";

// GAP-49 meal prep: recording a batch-cooking session (one PreparedBatch per
// dish, the dishes' ingredients deducted from inventory) and the toast's
// short-lived Undo. The inventory side is the same reviewed-checklist flow
// as "Mark as cooked" (cooking-actions.ts), shared through cook-inventory.ts,
// so a prep and a cook can never disagree on how stock is decremented or
// when an item lands on "Next shop" (AUTO-8). See
// docs/superpowers/specs/2026-10-14-meal-prep-design.md.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { round2 } from "@/lib/math";
import { fail, toFriendlyError, zodFail } from "@/lib/actions/errors";
import type { ActionState } from "@/lib/actions/auth";
import type { CookedIngredientData } from "@/components/meal-planning/types";
import {
  creditCookedIngredients,
  deductCookedIngredients,
  parseCookedRows,
  previewCookedIngredientsForRecipe,
} from "@/app/dashboard/meal-planning/cook-inventory";
import {
  defaultBatchExpiry,
  prepUndoSchema,
  recordPrepSchema,
  type PrepUndo,
} from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { findSessionMemberId } from "@/app/dashboard/meal-planning/prep-assign";
import { revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

// Each recipe's servings, keyed by id — or null when any id isn't one of
// this household's recipes. One query for the whole prep (at most
// MAX_PREP_DISHES ids); a dish listed twice is only looked up once.
async function loadHouseholdRecipeServings(
  householdId: string,
  recipeIds: string[],
): Promise<Map<string, number | null> | null> {
  const ids = [...new Set(recipeIds)];
  const recipes = await prisma.recipe.findMany({
    where: { id: { in: ids }, householdId },
    select: { id: true, servings: true },
  });
  if (recipes.length !== ids.length) return null;
  return new Map(recipes.map((recipe) => [recipe.id, recipe.servings]));
}

// Two dishes often share a staple (rice under both the curry and the chili),
// and the review checklist submits one decrement per inventory item, so each
// dish's preview is folded into a single row per item. Both quantities are
// already scaled per dish; suggestedQuantity is in the item's own unit (0
// for a row whose units couldn't be reconciled), so summing it keeps the
// single-recipe meaning. Sorted by name like computeCookedIngredients.
function mergeCookedIngredients(lists: CookedIngredientData[][]): CookedIngredientData[] {
  const byItem = new Map<string, CookedIngredientData>();
  for (const row of lists.flat()) {
    const existing = byItem.get(row.inventoryItemId);
    if (!existing) {
      byItem.set(row.inventoryItemId, { ...row });
      continue;
    }
    existing.requiredQuantity = round2(existing.requiredQuantity + row.requiredQuantity);
    existing.suggestedQuantity = round2(existing.suggestedQuantity + row.suggestedQuantity);
    existing.unitMismatch = existing.unitMismatch || row.unitMismatch;
  }
  return [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Read-only: what the prep would take out of inventory, for the review
// checklist. Nothing is written until recordPrepAction.
export async function previewPrepIngredientsAction(
  dishes: { recipeId: string; portions: number }[],
): Promise<{ items: CookedIngredientData[] } | { error: string }> {
  const { household } = await requireHousehold();

  // The same bounds recordPrepAction enforces — a Server Action is callable
  // directly, so the dish list is validated rather than trusted.
  const parsed = recordPrepSchema.safeParse(dishes);
  if (!parsed.success) return await zodFail(parsed.error);

  const servingsById = await loadHouseholdRecipeServings(
    household.id,
    parsed.data.map((dish) => dish.recipeId),
  );
  if (!servingsById) return await fail("recipeNotFound");

  const lists = await Promise.all(
    parsed.data.map((dish) =>
      previewCookedIngredientsForRecipe(household.id, dish.recipeId, dish.portions, servingsById.get(dish.recipeId)),
    ),
  );
  return { items: mergeCookedIngredients(lists) };
}

export async function recordPrepAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { undo?: PrepUndo; portions?: number; dishCount?: number }> {
  const { household, userId } = await requireHousehold();

  // The dish fields repeat once per dish and line up by index; a blank
  // expiry means "use the default eat-by date".
  const recipeIds = formData.getAll("dishRecipeId").map((value) => String(value).trim());
  const portions = formData.getAll("dishPortions").map((value) => String(value).trim());
  const expiries = formData.getAll("dishExpiry").map((value) => String(value).trim());
  const parsed = recordPrepSchema.safeParse(
    recipeIds.map((recipeId, i) => ({
      recipeId,
      portions: portions[i] ?? "",
      expiryDate: expiries[i] || undefined,
    })),
  );
  if (!parsed.success) return await zodFail(parsed.error);
  const dishes = parsed.data;

  // Every dish must be one of this household's recipes, checked before
  // anything is written — a tampered id fails the whole prep rather than
  // deducting stock for the dishes that did resolve.
  const servingsById = await loadHouseholdRecipeServings(
    household.id,
    dishes.map((dish) => dish.recipeId),
  );
  if (!servingsById) return await fail("recipeNotFound");

  const rows = parseCookedRows(formData);
  const autoAdded: AutoAddedItem[] = [];
  const batchIds: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      autoAdded.push(...(await deductCookedIngredients(tx, household.id, userId, rows)));

      const cookedByMemberId = await findSessionMemberId(tx, household.id, userId);
      // One instant for the whole prep, so every batch's cookedAt and
      // default eat-by date agree.
      const cookedAt = new Date();
      for (const dish of dishes) {
        const batch = await tx.preparedBatch.create({
          data: {
            householdId: household.id,
            recipeId: dish.recipeId,
            cookedByMemberId,
            totalPortions: dish.portions,
            remainingPortions: dish.portions,
            cookedAt,
            expiryDate: dish.expiryDate ? parseDateKey(dish.expiryDate) : defaultBatchExpiry(cookedAt),
          },
          select: { id: true },
        });
        batchIds.push(batch.id);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return {
    undo: {
      batchIds,
      // A row zeroed in the checklist deducted nothing, so there's nothing
      // to credit back — and prepUndoSchema only accepts positive amounts.
      rows: rows.filter((row) => row.quantity > 0),
      autoAdded,
    },
    portions: dishes.reduce((sum, dish) => sum + dish.portions, 0),
    dishCount: dishes.length,
  };
}

// --- Undo record prep (short-lived toast action) ------------------------------
//
// Like undoMarkMealEntryCookedAction, only for the fat-finger case right
// after recording: deletes the batches and credits the deducted ingredients
// back. Once any portion is planned the prep is real, so the undo refuses
// rather than silently unlinking a meal the household has already planned.
// The client takes the AUTO-8 rows back off "Next shop" with the existing
// undoAutoAddedItemsAction, as mark-cooked does.
export async function undoRecordPrepAction(undo: PrepUndo): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  // The payload round-trips through the client. A malformed one is a no-op
  // rather than an error: there's nothing the household could do about it,
  // and a toast's Undo shouldn't surface a validation message.
  const parsed = prepUndoSchema.safeParse(undo);
  if (!parsed.success) return {};
  const { batchIds, rows } = parsed.data;

  let refused = false;
  try {
    await prisma.$transaction(async (tx) => {
      const linkedEntries = await tx.mealPlanEntry.count({
        where: { preparedBatchId: { in: batchIds }, mealPlan: { householdId: household.id } },
      });
      if (linkedEntries > 0) {
        refused = true;
        return;
      }

      const deleted = await tx.preparedBatch.deleteMany({
        where: { id: { in: batchIds }, householdId: household.id },
      });
      // Idempotent: a double-clicked or stale Undo finds the batches already
      // gone and must not credit the ingredients back a second time.
      if (deleted.count === 0) return;

      await creditCookedIngredients(tx, household.id, userId, rows);
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  if (refused) return await fail("prepUndoAlreadyPlanned");

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}
