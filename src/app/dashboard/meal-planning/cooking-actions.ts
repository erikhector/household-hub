"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { datedName } from "@/lib/i18n/format";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import type { ActionState } from "@/lib/actions/auth";
import { NEW_SHOPPING_LIST_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import {
  parseMissingIngredientsRange,
  type MissingIngredientsRange,
} from "@/app/dashboard/meal-planning/missing-ingredients";
import { loadMissingIngredients } from "@/app/dashboard/meal-planning/missing-for-range";
import type { MissingIngredientData, CookedIngredientData } from "@/components/meal-planning/types";
import {
  MAX_INGREDIENT_QUANTITY,
  creditCookedIngredients,
  deductCookedIngredients,
  parseCookedRows,
  previewCookedIngredientsForRecipe,
} from "@/app/dashboard/meal-planning/cook-inventory";
import { revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";
import { createInventoryLinker } from "@/lib/shopping/inventory-link";
import {
  leftoverServingsSchema,
  leftoversChangeSchema,
  type LeftoversChange,
} from "@/app/dashboard/meal-planning/leftovers";
import { defaultBatchExpiry } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { findSessionMemberId } from "@/app/dashboard/meal-planning/prep-assign";
import { clearCookSoon } from "@/app/dashboard/meal-planning/cook-soon";
import { defaultLineEstimate } from "@/lib/shopping/unit-price";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

const MAX_MISSING_INGREDIENT_NAME_LENGTH = 120;
const MAX_MISSING_INGREDIENT_UNIT_LENGTH = 20;
// The row cap follows the shopping-list side's 300 rather than a recipe's
// own 100: this submits a whole range's shortfall (up to
// MAX_MISSING_INGREDIENTS_RANGE_DAYS of meals), not one recipe's ingredients.
const MAX_MISSING_INGREDIENT_ROWS = 300;

// --- Meal-plan → shopping-list bridge ---------------------------------------
//
// Diffs the planned recipe ingredients in a date range against current
// inventory and lets the user push the shortfall onto a shopping list.
// Defaults to the whole visible week (not a single day) — the competitor
// pattern (Mealime/Paprika/Plan to Eat/Whisk all diff a full week at once) —
// but since GAP-32 it takes any `[from, to)` range of up to
// MAX_MISSING_INGREDIENTS_RANGE_DAYS days, e.g. "this week and next" before a
// big trip. Freeform meal entries have no `recipeId` and therefore no
// ingredients, so they're naturally excluded by the `recipeId: { not: null }`
// filter below.
//
// This is a read-only preview — no rows are written — so the user can review
// suggested quantities before anything is committed via
// addMissingIngredientsToShoppingListAction below.
export async function previewMissingIngredientsAction(
  range: MissingIngredientsRange,
): Promise<{ items: MissingIngredientData[] } | { error: string }> {
  const { household } = await requireHousehold();

  // Zod-validated and capped server-side (see missing-ingredients.ts) — the
  // dialog checks the same thing, but a Server Action is callable directly.
  const parsed = parseMissingIngredientsRange(range);
  if (!parsed) {
    return await fail("invalidDateRange");
  }

  return await loadMissingIngredients(household.id, parsed);
}

// UX-91: what a successful add returns, for the toast's count and "Open list".
export type AddMissingState = ActionState & { listId?: string; addedCount?: number };

// Takes no date range of its own (GAP-32): it commits exactly the rows the
// user reviewed and left checked in the preview above, so whatever range the
// preview used is, by construction, the range that gets applied — there's
// no second meal-plan read here that could drift from it.
const addMissingIngredientsSchema = z.object({
  targetListId: z.string().min(1, v("chooseShoppingList")),
  newListName: z.string().trim().max(120).optional(),
});

export async function addMissingIngredientsToShoppingListAction(
  _prevState: AddMissingState,
  formData: FormData,
): Promise<AddMissingState> {
  const { household } = await requireHousehold();

  const parsed = addMissingIngredientsSchema.safeParse({
    targetListId: formData.get("targetListId"),
    newListName: formData.get("newListName") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const names = formData.getAll("itemName").map((v) => String(v).trim());
  if (names.length > MAX_MISSING_INGREDIENT_ROWS) {
    return await fail("selectAtMostIngredients", { max: MAX_MISSING_INGREDIENT_ROWS });
  }
  const quantities = formData.getAll("itemQuantity").map((v) => Number(v));
  const units = formData.getAll("itemUnit").map((v) => String(v).trim());

  const rows = names
    .map((name, i) => ({ name, quantity: quantities[i], unit: units[i] || "pcs" }))
    .filter(
      (row) =>
        row.name &&
        row.name.length <= MAX_MISSING_INGREDIENT_NAME_LENGTH &&
        row.unit.length <= MAX_MISSING_INGREDIENT_UNIT_LENGTH &&
        Number.isFinite(row.quantity) &&
        row.quantity > 0 &&
        row.quantity <= MAX_INGREDIENT_QUANTITY,
    );

  if (rows.length === 0) {
    return await fail("selectAtLeastOneIngredient");
  }

  let listId: string;
  if (parsed.data.targetListId === NEW_SHOPPING_LIST_SENTINEL) {
    const dict = await getDictionary();
    const list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name:
          parsed.data.newListName ||
          datedName(dict.shoppingList.defaultNamePrefix, await getLocale()),
      },
    });
    listId = list.id;
  } else {
    const list = await prisma.shoppingList.findFirst({
      where: { id: parsed.data.targetListId, householdId: household.id, status: "ACTIVE" },
    });
    if (!list) return await fail("shoppingListNotFound");
    listId = list.id;
  }

  // Mirrors generateFromLowStockAction's dedupe: don't add a second row for
  // an inventory item that's already pending (unpurchased) on the target
  // list — the user can adjust the quantity already there instead. An
  // unlinked row is deduped by name the same way.
  const alreadyOnList = await prisma.shoppingListItem.findMany({
    where: { shoppingListId: listId, purchased: false },
    select: { inventoryItemId: true, name: true },
  });
  const alreadyOnListIds = new Set(alreadyOnList.map((i) => i.inventoryItemId).filter(Boolean));
  const alreadyOnListNames = new Set(
    alreadyOnList.filter((i) => !i.inventoryItemId).map((i) => i.name.trim().toLowerCase()),
  );

  // MATCH-1: link each row the same way a pasted list or template does
  // (exact name, the household's learned alias for it (MATCH-5), else one
  // clear fuzzy match) over one inventory fetch, and
  // leave the rest unlinked for "Resolve mappings" on the list. This used
  // to find-or-create an inventory item for every unmatched name, which
  // filled the pantry with zero-stock phantoms.
  const [inventoryItems, aliases] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, lastKnownPrice: true },
    }),
    prisma.itemAlias.findMany({
      where: { householdId: household.id },
      select: { normalizedName: true, inventoryItemId: true },
    }),
  ]);
  const linkInventoryItem = createInventoryLinker(inventoryItems, aliases);

  const itemsToCreate: {
    shoppingListId: string;
    inventoryItemId: string | null;
    name: string;
    quantity: number;
    unit: string;
    estimatedPrice?: number;
    addedAutomatically: true;
  }[] = [];
  for (const row of rows) {
    const inventoryItem = linkInventoryItem(row.name);
    if (inventoryItem) {
      if (alreadyOnListIds.has(inventoryItem.id)) continue;
      alreadyOnListIds.add(inventoryItem.id);
    } else {
      const key = row.name.toLowerCase();
      if (alreadyOnListNames.has(key)) continue;
      alreadyOnListNames.add(key);
    }

    itemsToCreate.push({
      shoppingListId: listId,
      inventoryItemId: inventoryItem?.id ?? null,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      // AUTO-4: same last-known-price default as the other add paths.
      estimatedPrice: defaultLineEstimate(inventoryItem?.lastKnownPrice, row.quantity),
      addedAutomatically: true,
    });
  }
  if (itemsToCreate.length > 0) {
    await prisma.shoppingListItem.createMany({ data: itemsToCreate });
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  revalidatePath("/dashboard");

  // UX-91: the toast says how many rows landed (not how many were checked,
  // some may have been on the list already) and links to the list.
  return { listId, addedCount: itemsToCreate.length };
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
      preparedBatchId: true,
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
  if (!entry) return await fail("mealNotFound");
  if (!entry.recipeId) return await fail("noRecipeLinked");

  return {
    items: await previewCookedIngredientsForRecipe(household.id, entry.recipeId, entry.portions, entry.recipe?.servings),
  };
}

export async function markMealEntryCookedAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { autoAdded?: AutoAddedItem[]; leftovers?: LeftoversChange }> {
  const { household, userId } = await requireHousehold();

  const entryId = String(formData.get("entryId") ?? "");
  const entry = await loadCookableEntry(entryId, household.id);
  if (!entry) return await fail("mealNotFound");
  // Idempotent no-op — a stale button re-click or a double-submit shouldn't
  // decrement inventory twice, mirroring RecurringTemplateAck's
  // repeat-click idempotency elsewhere in this app.
  if (entry.consumedAt) return {};

  // GAP-49: a meal eaten from a prepared batch was cooked at prep time —
  // its ingredients came out then, and its portions out of the batch when
  // it was planned. Marking it eaten only records that, whatever rows or
  // leftovers a stale dialog still posts.
  const fromBatch = !!entry.preparedBatchId;

  // GAP-8: optional "servings left over". Validated up front, before
  // anything is written — a bad value rejects the whole cook rather than
  // decrementing ingredients and silently dropping the leftovers.
  const parsedLeftovers = leftoverServingsSchema.safeParse(formData.get("leftoverServings"));
  if (!fromBatch && !parsedLeftovers.success) {
    const dict = await getDictionary();
    return { error: dict.mealPlanning.leftoverServingsInvalid };
  }
  const leftoverServings = !fromBatch && parsedLeftovers.success ? parsedLeftovers.data : 0;

  const rows = fromBatch ? [] : parseCookedRows(formData);

  // Returned so MarkCookedDialog's existing Undo can take these rows back
  // off "Next shop" along with crediting inventory — one Undo for the whole
  // cook, rather than a second toast competing with it.
  const autoAdded: AutoAddedItem[] = [];
  // Set inside the transaction when leftovers were recorded — returned so
  // the same toast Undo can reverse them (see LeftoversChange).
  let leftovers: LeftoversChange | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      autoAdded.push(...(await deductCookedIngredients(tx, household.id, userId, rows)));

      // GAP-8: leftovers, in the same transaction as the cook so the two
      // can never disagree (a cook that rolls back never leaves a stray
      // batch behind). Only when the household typed a number — never
      // inferred from servings vs portions, per the Guardrails. Since
      // GAP-49 they're a PreparedBatch of the recipe, the same thing a prep
      // session records, so they can be planned portion by portion and show
      // on the planner's batch list, instead of a "Leftovers: …" inventory
      // row nothing could plan from.
      if (leftoverServings > 0 && entry.recipeId) {
        const cookedAt = new Date();
        const batch = await tx.preparedBatch.create({
          data: {
            householdId: household.id,
            recipeId: entry.recipeId,
            cookedByMemberId: await findSessionMemberId(tx, household.id, userId),
            totalPortions: leftoverServings,
            remainingPortions: leftoverServings,
            cookedAt,
            expiryDate: defaultBatchExpiry(cookedAt),
          },
          select: { id: true },
        });
        leftovers = { batchId: batch.id };
      }

      await tx.mealPlanEntry.update({
        where: { id: entry.id },
        data: { consumedAt: new Date() },
      });
      // GAP-51: cooked, so it's off the Cook soon shelf.
      await clearCookSoon(tx, household.id, entry.recipeId);
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return {
    ...(autoAdded.length > 0 ? { autoAdded } : {}),
    ...(leftovers ? { leftovers } : {}),
  };
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
  leftoversChange?: LeftoversChange,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  // A malformed payload just skips the leftovers part of the undo rather
  // than failing the whole thing — crediting the ingredients back is still
  // the more important half of the fat-finger fix.
  const parsedLeftovers = leftoversChange === undefined ? null : leftoversChangeSchema.safeParse(leftoversChange);
  const leftovers = parsedLeftovers?.success ? parsedLeftovers.data : null;

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true, consumedAt: true, preparedBatchId: true },
  });
  if (!entry) return await fail("mealNotFound");
  // Idempotent no-op — a stale/double-clicked undo shouldn't credit
  // inventory back twice, mirroring markMealEntryCookedAction's own guard.
  if (!entry.consumedAt) return {};
  // GAP-49: marking a meal from a batch eaten changed nothing but
  // consumedAt, so that's all its undo puts back.
  const fromBatch = !!entry.preparedBatchId;

  try {
    await prisma.$transaction(async (tx) => {
      if (!fromBatch) await creditCookedIngredients(tx, household.id, userId, rows);

      // GAP-8: reverse the leftovers batch too — undoing the cook should
      // undo everything it caused, same as the AUTO-8 auto-add rows. Once
      // "Plan leftovers" has put a portion on the plan the batch is real,
      // so, like undoRecordPrepAction, it stays and only this part of the
      // undo is skipped. deleteMany carries householdId in the filter so a
      // tampered batchId from another household simply matches nothing.
      if (!fromBatch && leftovers) {
        const planned = await tx.mealPlanEntry.count({
          where: { preparedBatchId: leftovers.batchId, mealPlan: { householdId: household.id } },
        });
        if (planned === 0) {
          await tx.preparedBatch.deleteMany({ where: { id: leftovers.batchId, householdId: household.id } });
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
