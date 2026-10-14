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
  assignPortionsSchema,
  defaultBatchExpiry,
  discardSnapshotSchema,
  portionsAfterReturn,
  prepUndoSchema,
  recordPrepSchema,
  type DiscardSnapshot,
  type PrepUndo,
} from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import {
  assignInTx,
  BatchChangedError,
  findSessionMemberId,
  PrepAssignError,
  returnEntryPortionsInTx,
  type AssignSlot,
} from "@/app/dashboard/meal-planning/prep-assign";
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

// --- Assign / unassign batch portions -----------------------------------------
//
// Handing a batch's portions out to planner slots. The arithmetic and slot
// rules live in prep-assign.ts's assignInTx, which addMealEntryAction reuses
// when a meal is added straight from a batch.
export async function assignBatchPortionsAction(input: {
  batchId: string;
  slots: AssignSlot[];
}): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = assignPortionsSchema.safeParse(input);
  if (!parsed.success) return await zodFail(parsed.error);
  const { batchId, slots } = parsed.data;

  const batch = await prisma.preparedBatch.findFirst({
    where: { id: batchId, householdId: household.id },
    select: { id: true, recipeId: true },
  });
  if (!batch) return await fail("prepBatchNotFound");

  try {
    await prisma.$transaction((tx) => assignInTx(tx, household.id, batch, slots));
  } catch (error) {
    // Expected outcomes (out of portions, slot taken) roll the transaction
    // back like any error, but are the household's to fix, not a bug.
    if (error instanceof PrepAssignError) return await fail(error.key);
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}

// Gives an entry's portions back to its batch and keeps the meal planned
// (it just cooks fresh again). A missing, unlinked or cooked entry is a
// no-op, as deleteMealEntryAction treats a missing entry: the button that
// sent it is stale, and there's nothing to give back. A cooked meal ate its
// portions, so they stay eaten.
export async function unassignBatchPortionAction(entryId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true, preparedBatchId: true, preparedPortionsUsed: true, consumedAt: true },
  });
  if (!entry || entry.consumedAt) return {};
  // A null batch with portions still counted means the batch went with its
  // recipe (SetNull); the entry is still reset so the pair is back in step.
  if (entry.preparedBatchId === null && entry.preparedPortionsUsed === 0) return {};
  const { preparedBatchId, preparedPortionsUsed } = entry;

  try {
    await prisma.$transaction(async (tx) => {
      // The reset goes first and is guarded on the values just read, so a
      // double-clicked Unplan returns the portions once: the second one
      // matches no row and stops here.
      const reset = await tx.mealPlanEntry.updateMany({
        where: { id: entry.id, preparedBatchId, preparedPortionsUsed, consumedAt: null },
        data: { preparedBatchId: null, preparedPortionsUsed: 0 },
      });
      if (reset.count === 0) return;
      await returnEntryPortionsInTx(tx, household.id, entry);
    });
  } catch (error) {
    if (error instanceof BatchChangedError) return await fail("generic");
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}

// --- Discard a batch and its Undo ---------------------------------------------
//
// Throwing a batch away keeps every meal planned from it (they keep their
// recipe and just stop eating from the batch). The returned snapshot is
// everything undoDiscardBatchAction needs to put it back, for the toast.
export async function discardBatchAction(
  batchId: string,
): Promise<ActionState & { snapshot?: DiscardSnapshot }> {
  const { household } = await requireHousehold();

  let snapshot: DiscardSnapshot | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const batch = await tx.preparedBatch.findFirst({
        where: { id: batchId, householdId: household.id },
        select: {
          id: true,
          recipeId: true,
          cookedByMemberId: true,
          totalPortions: true,
          remainingPortions: true,
          cookedAt: true,
          expiryDate: true,
        },
      });
      if (!batch) return;

      const linkedWhere = { preparedBatchId: batch.id, mealPlan: { householdId: household.id } };
      const entries = await tx.mealPlanEntry.findMany({
        where: linkedWhere,
        select: { id: true, preparedPortionsUsed: true },
      });
      // The FK's SetNull would clear the link on delete anyway; resetting
      // here also zeroes preparedPortionsUsed so the pair stays in step.
      await tx.mealPlanEntry.updateMany({
        where: linkedWhere,
        data: { preparedBatchId: null, preparedPortionsUsed: 0 },
      });
      await tx.preparedBatch.deleteMany({ where: { id: batch.id, householdId: household.id } });

      snapshot = {
        batch: {
          ...batch,
          cookedAt: batch.cookedAt.toISOString(),
          expiryDate: batch.expiryDate?.toISOString() ?? null,
        },
        // A linked entry that drew nothing has nothing to restore (and the
        // snapshot schema only takes positive portions).
        entries: entries
          .filter((e) => e.preparedPortionsUsed > 0)
          .map((e) => ({ id: e.id, portions: e.preparedPortionsUsed })),
      };
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  if (!snapshot) return await fail("prepBatchNotFound");

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return { snapshot };
}

// Puts a discarded batch back under its old id and re-links the meals that
// were eating from it. Like undoRecordPrepAction, a malformed snapshot (or
// one that no longer fits: recipe deleted, batch already restored) is a
// silent no-op rather than an error in the toast.
export async function undoDiscardBatchAction(snapshot: DiscardSnapshot): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = discardSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return {};
  const { batch, entries } = parsed.data;

  // The snapshot round-trips through the client, so its recipe and cook are
  // re-checked against this household rather than trusted.
  const recipe = await prisma.recipe.findFirst({
    where: { id: batch.recipeId, householdId: household.id },
    select: { id: true },
  });
  if (!recipe) return {};

  try {
    await prisma.$transaction(async (tx) => {
      // A repeated Undo finds the batch already back; an id that belongs to
      // some other row is left alone the same way.
      const existing = await tx.preparedBatch.findUnique({ where: { id: batch.id }, select: { id: true } });
      if (existing) return;

      const cook = batch.cookedByMemberId
        ? await tx.householdMember.findFirst({
            where: { id: batch.cookedByMemberId, householdId: household.id },
            select: { id: true },
          })
        : null;

      await tx.preparedBatch.create({
        data: {
          id: batch.id,
          householdId: household.id,
          recipeId: batch.recipeId,
          cookedByMemberId: cook?.id ?? null,
          totalPortions: batch.totalPortions,
          remainingPortions: batch.remainingPortions,
          cookedAt: new Date(batch.cookedAt),
          expiryDate: batch.expiryDate ? new Date(batch.expiryDate) : null,
        },
      });

      // Only entries that are still this household's, still free, and still
      // the same dish and size are re-linked, so a linked entry keeps
      // recipeId = batch.recipeId and portions = preparedPortionsUsed even
      // if it was edited after the discard (or the snapshot is forged). One
      // that no longer matches keeps its new state, and its portions go
      // back to the batch instead of vanishing.
      let unclaimed = 0;
      for (const entry of entries) {
        const relinked = await tx.mealPlanEntry.updateMany({
          where: {
            id: entry.id,
            mealPlan: { householdId: household.id },
            preparedBatchId: null,
            recipeId: batch.recipeId,
            portions: entry.portions,
          },
          data: { preparedBatchId: batch.id, preparedPortionsUsed: entry.portions },
        });
        if (relinked.count === 0) unclaimed += entry.portions;
      }
      if (unclaimed > 0) {
        await tx.preparedBatch.updateMany({
          where: { id: batch.id, householdId: household.id },
          data: {
            remainingPortions: portionsAfterReturn(batch.remainingPortions, batch.totalPortions, unclaimed),
          },
        });
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}
