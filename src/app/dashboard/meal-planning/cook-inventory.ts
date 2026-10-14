// Inventory side of cooking, shared by "Mark as cooked" (cooking-actions.ts)
// and recording a prep batch. Lives in its own plain module because
// cooking-actions.ts is a "use server" file, which may only export async
// functions — not the constant and the sync parser below. Deliberately no
// `import "server-only"`: the existing action tests import this module
// unmocked and that guard throws outside the Next.js server bundle.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/math";
import { recordOutOfStockTransition } from "@/lib/notifications";
import { addToDefaultListOnLowStock, type AutoAddedItem } from "@/lib/shopping/default-list";
import { computeCookedIngredients, type CookedIngredientNeed } from "@/app/dashboard/meal-planning/cooked-ingredients";
import { expandRecipeIngredients, portionsMultiplier } from "@/app/dashboard/meal-planning/recipe-expansion";
import type { CookedIngredientData } from "@/components/meal-planning/types";

// Mirrors recipe-actions.ts's identical bound on an ingredient's quantity,
// kept as its own copy here (rather than imported) to keep this feature's
// action files self-contained.
export const MAX_INGREDIENT_QUANTITY = 1_000_000;

type CookedRow = { itemId: string; quantity: number };

// Inventory quantities are stored to at most 2 decimal places (matches the
// precision cooked-ingredients.ts already suggests in the confirm dialog).
// The helpers below apply round2 (src/lib/math.ts) to both the submitted
// decrement/increment amount and the resulting stored quantity, to keep
// float arithmetic (e.g. 0.1 - 0.03) from drifting into long repeating
// decimals like 0.06999999999999999.

// Read-only: which of a recipe's ingredients resolve to an inventory item, and
// how much of each a cook would use. No rows are written.
export async function previewCookedIngredientsForRecipe(
  householdId: string,
  recipeId: string,
  portions: number,
  servings: number | null | undefined,
): Promise<CookedIngredientData[]> {
  const expanded = await expandRecipeIngredients(
    householdId,
    recipeId,
    portionsMultiplier(portions, servings),
    new Set(),
  );

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
      ? await prisma.inventoryItem.findMany({
          where: { householdId },
          include: { unitConversions: { select: { fromUnit: true, factor: true } } },
        })
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
        conversions: ingredient.conversions,
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
      conversions: loose.unitConversions,
    });
  }

  return computeCookedIngredients(needs);
}

// The review form's hidden itemId/itemQuantity pairs, rounded and dropped when
// blank, non-finite, negative or past the cap.
export function parseCookedRows(formData: FormData): CookedRow[] {
  const itemIds = formData.getAll("itemId").map((v) => String(v).trim());
  const quantities = formData.getAll("itemQuantity").map((v) => Number(v));

  return itemIds
    .map((itemId, i) => ({ itemId, quantity: round2(quantities[i]) }))
    .filter(
      (row) =>
        row.itemId &&
        Number.isFinite(row.quantity) &&
        row.quantity >= 0 &&
        row.quantity <= MAX_INGREDIENT_QUANTITY,
    );
}

// Decrements the rows' inventory items (this household's only; others are skipped),
// recording out-of-stock transitions and AUTO-8 auto-adds to "Next shop".
export async function deductCookedIngredients(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string,
  rows: CookedRow[],
): Promise<AutoAddedItem[]> {
  const autoAdded: AutoAddedItem[] = [];
  if (rows.length > 0) {
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: rows.map((r) => r.itemId) }, householdId },
    });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    for (const row of rows) {
      const item = itemsById.get(row.itemId);
      if (!item) continue; // not this household's item — silently skip, mirrors bulkUpdateFieldAction
      const nextQuantity = round2(Math.max(0, item.quantity - row.quantity));
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: nextQuantity, updatedByUserId: userId },
      });
      await recordOutOfStockTransition(tx, householdId, item.id, item.quantity, nextQuantity, userId);
      const added = await addToDefaultListOnLowStock(tx, householdId, item.id, item.quantity, nextQuantity);
      if (added) autoAdded.push(added);
    }
  }
  return autoAdded;
}

// Reverses deductCookedIngredients: adds the same amounts back. Validates the
// rows itself because undo takes them from the client.
export async function creditCookedIngredients(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string,
  rows: CookedRow[],
): Promise<void> {
  const validRows = rows
    .map((row) => ({ ...row, quantity: round2(row.quantity) }))
    .filter(
      (row) =>
        row.itemId &&
        Number.isFinite(row.quantity) &&
        row.quantity >= 0 &&
        row.quantity <= MAX_INGREDIENT_QUANTITY,
    );

  if (validRows.length > 0) {
    const items = await tx.inventoryItem.findMany({
      where: { id: { in: validRows.map((r) => r.itemId) }, householdId },
    });
    const itemsById = new Map(items.map((item) => [item.id, item]));

    for (const row of validRows) {
      const item = itemsById.get(row.itemId);
      if (!item) continue; // not this household's item — silently skip, mirrors deductCookedIngredients
      const nextQuantity = round2(item.quantity + row.quantity);
      await tx.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: nextQuantity, updatedByUserId: userId },
      });
    }
  }
}
