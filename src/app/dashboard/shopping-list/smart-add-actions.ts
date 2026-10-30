"use server";

// MAINT-3: the smart-add bar and the dialog that resolves its unmapped
// names, split out of the old actions.ts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, zodFail } from "@/lib/actions/errors";
import { learnItemAlias } from "@/lib/item-alias";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { matchSmartAddInventoryItem } from "@/lib/shopping/smart-add-suggestions";
import { defaultLineEstimate } from "@/lib/shopping/unit-price";

const smartAddSchema = z.object({
  listId: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        quantity: z.coerce.number().min(0.01).max(100000),
        unit: z.string().trim().max(20).optional(),
        inventoryItemId: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * The commit path behind the shopping list's smart add line (AUTO-1,
 * SmartAddBar): one or more rows, already split by parseSmartAddInput
 * (src/lib/shopping/smart-add-suggestions.ts — the same path a future voice
 * input is meant to feed), added in one round trip. Unlike
 * importShoppingListItemsAction, every row ends up linked, since this is the
 * everyday "add milk" path and an unlinked row is a chore left for later:
 *
 *   1. a picked suggestion's `inventoryItemId` (only if it's this
 *      household's — anything else is ignored, not trusted);
 *   2. otherwise matchSmartAddInventoryItem's pick — an exact (normalized)
 *      name, the household's learned alias for it (MATCH-5), the one item
 *      containing every typed word ("mjölk" →
 *      "Mjölk 3%"), or a single confident findInventoryMatches hit;
 *   3. otherwise a new InventoryItem (quantity 0, category guessed by AUTO-2's
 *      createCategoryResolver), shared by any later row in the same batch
 *      with the same case-insensitive name.
 *
 * Rows whose item is already pending on this list — or earlier in the same
 * batch — are skipped and reported back in `alreadyOnList` rather than
 * added as a duplicate or bumping the existing row's quantity, the same
 * dedupe generateFromLowStockAction does. `addedIds` lets the list briefly
 * highlight the new rows.
 */
export async function smartAddShoppingListItemsAction(
  listId: string,
  items: { name: string; quantity: number; unit?: string; inventoryItemId?: string }[],
): Promise<ActionState & { addedIds?: string[]; alreadyOnList?: string[] }> {
  const { household, userId } = await requireHousehold();

  const parsed = smartAddSchema.safeParse({ listId, items });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return await fail("listNotEditable");

  const addedIds: string[] = [];
  const alreadyOnList: string[] = [];
  let createdInventory = false;
  try {
    const [inventoryItems, aliases, pending] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
      prisma.itemAlias.findMany({
        where: { householdId: household.id },
        select: { normalizedName: true, inventoryItemId: true },
      }),
      prisma.shoppingListItem.findMany({
        where: { shoppingListId: list.id, purchased: false, inventoryItemId: { not: null } },
        select: { inventoryItemId: true },
      }),
    ]);
    const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
    const onList = new Set(pending.map((item) => item.inventoryItemId));

    // Planned up front, outside the transaction, so category guesses (which
    // may query) don't hold it open — same split as
    // resolveShoppingListMappingsAction. A new item is keyed by its
    // lowercased name until the transaction gives it an id.
    const resolveCategory = createCategoryResolver(household.id, inventoryItems);
    const newItems = new Map<string, { name: string; unit: string; category: string }>();
    const rows: {
      name: string;
      quantity: number;
      unit: string;
      inventoryItemId?: string;
      newKey?: string;
      estimatedPrice?: number;
    }[] = [];
    // AUTO-2b(a): every new item whose guess misses here is a candidate for
    // the AI fallback, scheduled once (batched) after the transaction below
    // actually creates the rows.
    const aiCandidates: string[] = [];

    for (const row of parsed.data.items) {
      let existing = row.inventoryItemId ? inventoryById.get(row.inventoryItemId) : undefined;
      existing ??= matchSmartAddInventoryItem(row.name, inventoryItems, aliases) ?? undefined;

      if (existing) {
        if (onList.has(existing.id)) {
          alreadyOnList.push(existing.name);
          continue;
        }
        onList.add(existing.id);
        rows.push({
          name: row.name,
          quantity: row.quantity,
          unit: row.unit || existing.unit || "pcs",
          inventoryItemId: existing.id,
          // AUTO-4: same last-known-price default as the other create
          // paths — a brand-new item created just below has no price yet,
          // so this only ever fires for the "existing" branch.
          estimatedPrice: defaultLineEstimate(existing.lastKnownPrice, row.quantity),
        });
        continue;
      }

      const newKey = row.name.toLowerCase();
      if (newItems.has(newKey)) {
        alreadyOnList.push(newItems.get(newKey)!.name);
        continue;
      }
      const unit = row.unit || "pcs";
      const guessed = await resolveCategory(row.name);
      if (!guessed) aiCandidates.push(row.name);
      newItems.set(newKey, { name: row.name, unit, category: guessed || "Uncategorized" });
      rows.push({ name: row.name, quantity: row.quantity, unit, newKey });
    }

    if (rows.length > 0) {
      await prisma.$transaction(async (tx) => {
        const createdIds = new Map<string, string>();
        for (const [key, item] of newItems) {
          const created = await tx.inventoryItem.create({
            data: {
              householdId: household.id,
              name: item.name,
              category: item.category,
              unit: item.unit,
              quantity: 0,
              lowStockThreshold: 0,
            },
          });
          createdIds.set(key, created.id);
        }
        for (const row of rows) {
          const created = await tx.shoppingListItem.create({
            data: {
              shoppingListId: list.id,
              addedByUserId: userId,
              inventoryItemId: row.inventoryItemId ?? createdIds.get(row.newKey!) ?? null,
              name: row.name,
              quantity: row.quantity,
              unit: row.unit,
              estimatedPrice: row.estimatedPrice,
            },
          });
          addedIds.push(created.id);
        }
      });
      createdInventory = newItems.size > 0;
      if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  if (addedIds.length > 0) revalidatePath(`/dashboard/shopping-list/${list.id}`);
  if (createdInventory) revalidatePath("/dashboard/inventory");
  return { addedIds, alreadyOnList };
}

export type MappingResolution =
  | { itemId: string; kind: "existing"; inventoryItemId: string }
  | { itemId: string; kind: "new"; category: string };

/**
 * Resolves several unlinked shopping-list items' inventory mappings in one
 * round trip — the batch counterpart to linkShoppingListItemAction /
 * createInventoryItemFromShoppingListItemAction (item-actions.ts), for the "resolve N
 * items" review dialog (ResolveMappingsDialog) that appears once a list has
 * enough unmapped items that going through them one at a time would be
 * tedious. Silently skips any resolution whose item doesn't belong to the
 * caller's household, is already linked, or names an inventory item outside
 * the household — rather than failing the whole batch over one stale/bad
 * row — and reports back how many actually resolved. An "existing" link
 * teaches an alias the same way linkShoppingListItemAction does (MATCH-5).
 */
export async function resolveShoppingListMappingsAction(
  resolutions: MappingResolution[],
): Promise<ActionState & { resolvedCount?: number }> {
  const { household } = await requireHousehold();
  if (resolutions.length === 0) return { resolvedCount: 0 };

  const items = await prisma.shoppingListItem.findMany({
    where: { id: { in: resolutions.map((r) => r.itemId) }, shoppingList: { householdId: household.id } },
  });
  const itemsById = new Map(items.map((item) => [item.id, item]));

  let shoppingListId: string | null = null;
  let resolvedCount = 0;

  try {
    // Categories for "new" rows left blank are guessed up front (AUTO-2) so
    // the transaction below stays writes-only.
    const resolveCategory = createCategoryResolver(household.id);
    const guessedCategories = new Map<string, string>();
    for (const resolution of resolutions) {
      const item = itemsById.get(resolution.itemId);
      if (resolution.kind !== "new" || !item || item.inventoryItemId !== null || resolution.category.trim()) continue;
      const guess = await resolveCategory(item.name);
      if (guess) guessedCategories.set(item.id, guess);
    }
    // AUTO-2b(a): "new" rows whose category is still blank after the guess
    // above are AI fallback candidates, scheduled (batched) once the
    // transaction below actually creates them.
    const aiCandidates = resolutions
      .map((resolution) => {
        const item = itemsById.get(resolution.itemId);
        if (resolution.kind !== "new" || !item || item.inventoryItemId !== null) return null;
        return resolution.category.trim() || guessedCategories.has(item.id) ? null : item.name;
      })
      .filter((name): name is string => name !== null);

    // Per-row writes are parallelized with Promise.all rather than a
    // sequential for-await loop (SCALE-C) — the rows being written already
    // don't overlap (each resolution targets its own shoppingListItem/
    // inventoryItem), so this only cuts wall-clock transaction hold time,
    // it doesn't change which rows end up written. Results are collected
    // and folded into shoppingListId/resolvedCount afterward, in the same
    // input order the old loop used, so both end up identical to before —
    // including shoppingListId being set for an attempted-but-not-found
    // "existing" resolution even though it didn't increment resolvedCount.
    await prisma.$transaction(async (tx) => {
      const results = await Promise.all(
        resolutions.map(async (resolution) => {
          const item = itemsById.get(resolution.itemId);
          if (!item || item.inventoryItemId !== null) return null;

          if (resolution.kind === "existing") {
            const inventoryItem = await tx.inventoryItem.findFirst({
              where: { id: resolution.inventoryItemId, householdId: household.id },
            });
            if (!inventoryItem) return { shoppingListId: item.shoppingListId, resolved: false };
            await tx.shoppingListItem.update({
              where: { id: item.id },
              data: { inventoryItemId: inventoryItem.id },
            });
            await learnItemAlias(tx, household.id, item.name, inventoryItem);
            return { shoppingListId: item.shoppingListId, resolved: true };
          }

          const trimmedCategory = resolution.category.trim().slice(0, 60);
          const inventoryItem = await tx.inventoryItem.create({
            data: {
              householdId: household.id,
              name: item.name,
              category: trimmedCategory || guessedCategories.get(item.id) || "Uncategorized",
              quantity: 0,
              lowStockThreshold: 0,
            },
          });
          await tx.shoppingListItem.update({
            where: { id: item.id },
            data: { inventoryItemId: inventoryItem.id },
          });
          return { shoppingListId: item.shoppingListId, resolved: true };
        }),
      );

      for (const result of results) {
        if (!result) continue;
        shoppingListId = result.shoppingListId;
        if (result.resolved) resolvedCount++;
      }
    });
    if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);
  } catch (error) {
    return toFriendlyError(error);
  }

  if (shoppingListId) {
    revalidatePath(`/dashboard/shopping-list/${shoppingListId}`);
    revalidatePath("/dashboard/inventory");
  }
  return { resolvedCount };
}
