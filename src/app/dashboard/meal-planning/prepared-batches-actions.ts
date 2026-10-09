"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/auth";
import { portionsMultiplier, expandRecipeIngredients } from "./recipe-expansion";
import { computeCookedIngredients } from "./cooked-ingredients";
import { round2 } from "@/lib/math";
import { recordOutOfStockTransition } from "@/lib/notifications";
import { addToDefaultListOnLowStock, revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";

const DASHBOARD_PATH = "/dashboard";

const createBatchSchema = z.object({
  recipeId: z.string().min(1),
  totalPortions: z.coerce.number().int().min(1),
  cookedByMemberId: z.string().optional(),
  expiryDate: z.string().optional(),
});

export async function createPreparedBatchAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = createBatchSchema.safeParse({
    recipeId: formData.get("recipeId"),
    totalPortions: formData.get("totalPortions"),
    cookedByMemberId: formData.get("cookedByMemberId") || undefined,
    expiryDate: formData.get("expiryDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { recipeId, totalPortions, cookedByMemberId, expiryDate } = parsed.data;

  // Verify recipe ownership
  const recipe = await prisma.recipe.findFirst({ where: { id: recipeId, householdId: household.id } });
  if (!recipe) return { error: "Recipe not found" };

  // We'll expand the recipe into ingredient needs and decrement inventory
  const autoAdded: AutoAddedItem[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      // Expand recipe ingredients scaled to the batch's totalPortions
      const recipeMultiplier = portionsMultiplier(totalPortions, recipe.servings);
      const expanded = await expandRecipeIngredients(household.id, recipeId, recipeMultiplier, new Set());

      // Collect loose-name matches for any ingredients without inventoryItemId
      const looseNames = new Set<string>();
      for (const ing of expanded) if (!ing.inventoryItemId) looseNames.add(ing.name.toLowerCase());
      const looseMatches =
        looseNames.size > 0
          ? await tx.inventoryItem.findMany({ where: { householdId: household.id }, include: { unitConversions: { select: { fromUnit: true, factor: true } } } })
          : [];
      const looseByName = new Map(looseMatches.filter((i) => looseNames.has(i.name.toLowerCase())).map((i) => [i.name.toLowerCase(), i]));

      // Build CookedIngredientNeed-like list for computeCookedIngredients
      const needs = expanded
        .map((ingredient) => {
          if (ingredient.inventoryItemId) return ingredient;
          const loose = looseByName.get(ingredient.name.toLowerCase());
          if (loose) {
            return {
              inventoryItemId: loose.id,
              inventoryItemName: loose.name,
              onHandQuantity: loose.quantity,
              onHandUnit: loose.unit,
              conversions: loose.unitConversions ?? [],
              name: ingredient.name,
              unit: ingredient.unit,
              quantity: ingredient.quantity,
            } as any;
          }
          return null;
        })
        .filter(Boolean) as any[];

      const cooked = computeCookedIngredients(needs);

      // Decrement each inventory item by its suggestedQuantity (rounded)
      for (const row of cooked) {
        if (row.suggestedQuantity <= 0) continue;
        const item = await tx.inventoryItem.findFirst({ where: { id: row.inventoryItemId as string, householdId: household.id } });
        if (!item) continue;
        const nextQuantity = round2(Math.max(0, item.quantity - row.suggestedQuantity));
        await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: nextQuantity } });
        await recordOutOfStockTransition(tx, household.id, item.id, item.quantity, nextQuantity, userId ?? null);
        const added = await addToDefaultListOnLowStock(tx, household.id, item.id, item.quantity, nextQuantity);
        if (added) autoAdded.push(added);
      }

      // Create the prepared batch row
      await tx.preparedBatch.create({
        data: {
          householdId: household.id,
          recipeId,
          cookedByMemberId: cookedByMemberId || null,
          totalPortions: totalPortions,
          remainingPortions: totalPortions,
          cookedAt: new Date(),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
        },
      });
    });
    // Revalidate any auto-added shopping list entries
    if (autoAdded.length > 0) revalidateAutoAdded(autoAdded);
  } catch (err) {
    return { error: "Failed to create batch" };
  }

  revalidatePath(DASHBOARD_PATH);
  revalidatePath("/dashboard/meal-planning");
  return {};
}

const assignSchema = z.object({ entryId: z.string().min(1), batchId: z.string().min(1), portions: z.coerce.number().int().min(1) });

export async function assignPreparedPortionsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = assignSchema.safeParse({ entryId: formData.get("entryId"), batchId: formData.get("batchId"), portions: formData.get("portions") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { entryId, batchId, portions } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const batch = await tx.preparedBatch.findFirst({ where: { id: batchId, householdId: household.id } });
      if (!batch) throw new Error("Batch not found");
      if (batch.remainingPortions < portions) throw new Error("Not enough portions");

      const entry = await tx.mealPlanEntry.findFirst({ where: { id: entryId, mealPlan: { householdId: household.id } } });
      if (!entry) throw new Error("Meal not found");
      if (entry.preparedBatchId) throw new Error("Entry already assigned to a batch");

      await tx.preparedBatch.update({ where: { id: batchId }, data: { remainingPortions: { decrement: portions } } as any });
      await tx.mealPlanEntry.update({ where: { id: entry.id }, data: { preparedBatchId: batchId, preparedPortionsUsed: portions } as any });
    });
  } catch (err) {
    return { error: String(err) };
  }

  revalidatePath("/dashboard/meal-planning");
  return {};
}

const unassignSchema = z.object({ entryId: z.string().min(1) });

export async function unassignPreparedPortionsAction(entryId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const entry = await prisma.mealPlanEntry.findFirst({ where: { id: entryId, mealPlan: { householdId: household.id } } });
  if (!entry) return { error: "Meal not found" };
  if (!entry.preparedBatchId || !entry.preparedPortionsUsed) return {};

  try {
    await prisma.$transaction(async (tx) => {
      await tx.preparedBatch.updateMany({ where: { id: entry.preparedBatchId as string, householdId: household.id }, data: { remainingPortions: { increment: entry.preparedPortionsUsed } } as any });
      await tx.mealPlanEntry.update({ where: { id: entry.id }, data: { preparedBatchId: null, preparedPortionsUsed: 0 } as any });
    });
  } catch (err) {
    return { error: "Failed to unassign" };
  }

  revalidatePath("/dashboard/meal-planning");
  return {};
}
