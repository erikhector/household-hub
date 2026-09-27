"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { canonicalUnit } from "@/lib/units";
import { conversionProblem, isFactorInRange, planUnitChange } from "@/lib/inventory/item-units";
import { sortedPair } from "@/lib/inventory/duplicates";
import {
  convertBetweenUnits,
  MAX_MERGE_ITEMS,
  planListRowMerges,
  planMerge,
  type MergeItem,
} from "@/lib/inventory/merge";

// The item page's writes (MATCH-6, design §6.1): an item's unit
// conversions, "Change unit…" and removing a learned alias. Then the item
// catalog's (MATCH-7, §6.2–6.3): "Not duplicates", and the merge preview
// and merge. Every one checks the items (or the alias) against the
// session's household first;
// ItemUnitConversion has no householdId of its own, so it's only ever
// reached through an item that passed that check.

function revalidateItem(itemId: string) {
  revalidatePath(`/dashboard/inventory/items/${itemId}`);
  revalidatePath("/dashboard/inventory");
  // Recipes' cost, the Cook tab and the shopping bridge all convert
  // through these conversions.
  revalidatePath("/dashboard/meal-planning");
}

// FormData numbers may be typed with a decimal comma.
const numberField = z
  .string()
  .trim()
  .transform((value) => Number(value.replace(",", ".")));

const conversionSchema = z.object({
  itemId: z.string().min(1),
  // Set when editing an existing row; its unit may change.
  conversionId: z.string().optional(),
  fromUnit: z.string().trim().min(1).max(20),
  factor: numberField,
});

class ConversionNotFound extends Error {}

export async function saveUnitConversionAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).inventory.itemPage;

  const parsed = conversionSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    conversionId: formData.get("conversionId") || undefined,
    fromUnit: formData.get("fromUnit") ?? "",
    factor: formData.get("factor") ?? "",
  });
  if (!parsed.success) return { error: dict.errors.invalid };
  const { itemId, conversionId } = parsed.data;
  const fromUnit = canonicalUnit(parsed.data.fromUnit);
  if (!isFactorInRange(parsed.data.factor)) return { error: dict.errors.factorRange };

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
    select: { id: true, unit: true },
  });
  if (!item) return { error: dict.errors.notFound };
  const problem = conversionProblem(fromUnit, item.unit);
  if (problem) return { error: dict.errors[problem] };

  try {
    await prisma.$transaction(async (tx) => {
      if (conversionId) {
        // Editing: the row must belong to this (already checked) item. A
        // changed unit replaces the row, and the upsert below then keeps
        // one row per unit even if the new unit already had one.
        const existing = await tx.itemUnitConversion.findFirst({
          where: { id: conversionId, inventoryItemId: item.id },
          select: { id: true, fromUnit: true },
        });
        if (!existing) throw new ConversionNotFound();
        if (existing.fromUnit !== fromUnit) await tx.itemUnitConversion.delete({ where: { id: existing.id } });
      }
      await tx.itemUnitConversion.upsert({
        where: { inventoryItemId_fromUnit: { inventoryItemId: item.id, fromUnit } },
        create: { inventoryItemId: item.id, fromUnit, factor: parsed.data.factor },
        update: { factor: parsed.data.factor },
      });
    });
  } catch (error) {
    if (error instanceof ConversionNotFound) return { error: dict.errors.notFound };
    return toFriendlyError(error);
  }

  revalidateItem(item.id);
  return {};
}

export async function deleteUnitConversionAction(conversionId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  let itemId: string;
  try {
    const conversion = await prisma.itemUnitConversion.findFirst({
      where: { id: conversionId, inventoryItem: { householdId: household.id } },
      select: { id: true, inventoryItemId: true },
    });
    if (!conversion) return { error: (await getDictionary()).inventory.itemPage.errors.notFound };
    await prisma.itemUnitConversion.delete({ where: { id: conversion.id } });
    itemId = conversion.inventoryItemId;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateItem(itemId);
  return {};
}

const changeUnitSchema = z.object({
  itemId: z.string().min(1),
  unit: z.string().trim().min(1).max(20),
  factor: numberField,
});

// Thrown inside the transaction to roll it back; neither is exported (a
// "use server" file may only export async functions).
class StockChanged extends Error {}

export async function changeItemUnitAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const { household, userId } = await requireHousehold();
  const dict = (await getDictionary()).inventory.itemPage;

  const parsed = changeUnitSchema.safeParse({
    itemId: formData.get("itemId") ?? "",
    unit: formData.get("unit") ?? "",
    factor: formData.get("factor") ?? "",
  });
  if (!parsed.success) return { error: dict.errors.invalid };

  const item = await prisma.inventoryItem.findFirst({
    where: { id: parsed.data.itemId, householdId: household.id },
    select: {
      id: true,
      unit: true,
      quantity: true,
      lowStockThreshold: true,
      unitConversions: { select: { fromUnit: true, factor: true } },
    },
  });
  if (!item) return { error: dict.errors.notFound };

  const result = planUnitChange({ ...item, conversions: item.unitConversions }, parsed.data.unit, parsed.data.factor);
  if ("problem" in result) return { error: dict.errors[result.problem] };
  const { plan } = result;

  try {
    await prisma.$transaction(async (tx) => {
      // Only if the stock, threshold and unit are still what the plan was
      // made from: a +/- tap from another phone in between would otherwise
      // be multiplied twice or lost.
      const updated = await tx.inventoryItem.updateMany({
        where: {
          id: item.id,
          householdId: household.id,
          unit: item.unit,
          quantity: item.quantity,
          lowStockThreshold: item.lowStockThreshold,
        },
        data: {
          unit: plan.unit,
          quantity: plan.quantity,
          lowStockThreshold: plan.lowStockThreshold,
          updatedByUserId: userId,
        },
      });
      if (updated.count === 0) throw new StockChanged();
      // lastKnownPrice and PriceHistory stay: they're per purchase line and
      // record their own unit (GAP-9).
      await tx.itemUnitConversion.deleteMany({ where: { inventoryItemId: item.id } });
      await tx.itemUnitConversion.createMany({
        data: plan.conversions.map((conversion) => ({ inventoryItemId: item.id, ...conversion })),
      });
    });
  } catch (error) {
    if (error instanceof StockChanged) return { error: dict.errors.stockChanged };
    return toFriendlyError(error);
  }

  revalidateItem(item.id);
  revalidatePath("/dashboard");
  return {};
}

export async function removeItemAliasAction(aliasId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  let itemId: string | null;
  try {
    const alias = await prisma.itemAlias.findFirst({
      where: { id: aliasId, householdId: household.id },
      select: { id: true, inventoryItemId: true },
    });
    if (!alias) return { error: (await getDictionary()).inventory.itemPage.errors.notFound };
    await prisma.itemAlias.delete({ where: { id: alias.id } });
    itemId = alias.inventoryItemId;
  } catch (error) {
    return toFriendlyError(error);
  }

  if (itemId) revalidateItem(itemId);
  return {};
}

// --- Item catalog (MATCH-7) ---------------------------------------------------

function revalidateCatalog() {
  revalidatePath("/dashboard/inventory/items");
  revalidatePath("/dashboard/inventory");
}

// A group can be longer than a merge: it's every item joined by a pair.
const MAX_DISMISS_ITEMS = 50;
const dismissSchema = z
  .array(z.string().min(1))
  .min(2)
  .max(MAX_DISMISS_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length);

/**
 * "Not duplicates" on a group: stores every pair in it, ids sorted, so
 * findDuplicateGroups never pairs any two of them again, for anyone in the
 * household. Pairs already stored are skipped.
 */
export async function dismissDuplicatesAction(itemIds: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).inventory.catalog.errors;
  const parsed = dismissSchema.safeParse(itemIds);
  if (!parsed.success) return { error: dict.invalid };
  const ids = parsed.data;

  try {
    const found = await prisma.inventoryItem.count({ where: { id: { in: ids }, householdId: household.id } });
    if (found !== ids.length) return { error: dict.notFound };
    const data = ids.flatMap((a, i) =>
      ids.slice(i + 1).map((b) => {
        const [itemAId, itemBId] = sortedPair(a, b);
        return { householdId: household.id, itemAId, itemBId };
      }),
    );
    await prisma.inventoryDuplicateDismissal.createMany({ data, skipDuplicates: true });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateCatalog();
  return {};
}

const mergeTargetsSchema = z
  .object({
    keeperId: z.string().min(1),
    mergeIds: z.array(z.string().min(1)).min(1),
  })
  .refine(({ mergeIds }) => new Set(mergeIds).size === mergeIds.length);

type MergeTargetsError = "invalid" | "tooMany" | "keeperInMerge";

function checkMergeTargets(keeperId: unknown, mergeIds: unknown): { error: MergeTargetsError } | { keeperId: string; mergeIds: string[] } {
  const parsed = mergeTargetsSchema.safeParse({ keeperId, mergeIds });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.mergeIds.length > MAX_MERGE_ITEMS) return { error: "tooMany" };
  if (parsed.data.mergeIds.includes(parsed.data.keeperId)) return { error: "keeperInMerge" };
  return parsed.data;
}

const mergeItemSelect = {
  id: true,
  name: true,
  unit: true,
  quantity: true,
  lowStockThreshold: true,
  lastKnownPrice: true,
  expiresAt: true,
  expiresAtEstimated: true,
  category: true,
  barcode: true,
  unitConversions: { select: { fromUnit: true, factor: true } },
  _count: {
    select: {
      recipeIngredients: true,
      shoppingListItems: true,
      listTemplateItems: true,
      priceHistory: true,
      aliases: true,
      unitConversions: true,
    },
  },
} as const;

/** The keeper and every merged item in one household-scoped query, or
 * null when any of them isn't this household's (or is gone). */
async function loadMergeItems(householdId: string, keeperId: string, mergeIds: readonly string[]) {
  const rows = await prisma.inventoryItem.findMany({
    where: { id: { in: [keeperId, ...mergeIds] }, householdId },
    select: mergeItemSelect,
  });
  const byId = new Map(
    rows.map(({ unitConversions, _count, ...row }) => [
      row.id,
      {
        item: { ...row, conversions: unitConversions } satisfies MergeItem,
        counts: {
          recipes: _count.recipeIngredients,
          listRows: _count.shoppingListItems,
          templates: _count.listTemplateItems,
          prices: _count.priceHistory,
          aliases: _count.aliases,
          conversions: _count.unitConversions,
        },
      },
    ]),
  );
  const keeper = byId.get(keeperId);
  const merged = mergeIds.map((id) => byId.get(id));
  if (!keeper || merged.some((entry) => entry === undefined)) return null;
  return { keeper: keeper.item, merged: merged.map((entry) => entry!) };
}

export type MergePreview = {
  keeper: MergeItem;
  items: (MergeItem & {
    counts: { recipes: number; listRows: number; templates: number; prices: number; aliases: number; conversions: number };
  })[];
};

/**
 * Read-only: everything the merge dialog needs to show exactly what a
 * merge will move (design §6.3, "Confirm, not undo"). The dialog runs the
 * same planMerge over it as mergeInventoryItemsAction, with the factors
 * typed so far, so the stock and field outcome it shows are the ones the
 * merge writes.
 */
export async function previewMergeAction(
  keeperId: string,
  mergeIds: string[],
): Promise<{ error: string } | { preview: MergePreview }> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).inventory.catalog.errors;
  const targets = checkMergeTargets(keeperId, mergeIds);
  if ("error" in targets) return { error: dict[targets.error] };

  try {
    const loaded = await loadMergeItems(household.id, targets.keeperId, targets.mergeIds);
    if (!loaded) return { error: dict.notFound };
    return {
      preview: { keeper: loaded.keeper, items: loaded.merged.map(({ item, counts }) => ({ ...item, counts })) },
    };
  } catch (error) {
    return { error: toFriendlyError(error).error! };
  }
}

const mergeSchema = z.object({
  keeperId: z.string().min(1),
  merge: z.array(z.object({ id: z.string().min(1), factor: z.number().finite().positive().optional() })).min(1),
});

// Thrown inside the merge transaction to roll it back.
class MergeStockChanged extends Error {}

/**
 * Merges up to ten items into the keeper (design §6.3), all in one
 * transaction: stock converted and added (a typed factor for units that
 * don't convert is saved on the keeper), recipe, list, template and price
 * rows re-pointed (pending rows on the same list added together when their
 * units convert), aliases re-pointed and each merged name saved as a new
 * one, conversions re-expressed, the barcode handed over when the keeper
 * has none, empty fields filled, stale notifications deleted, and the
 * merged items deleted. Their "Not duplicates" rows go with them
 * (cascade). There's no undo: the preview is the confirmation.
 */
export async function mergeInventoryItemsAction(input: {
  keeperId: string;
  merge: { id: string; factor?: number }[];
}): Promise<ActionState> {
  const { household, userId } = await requireHousehold();
  const dict = (await getDictionary()).inventory.catalog.errors;
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { error: dict.invalid };
  const targets = checkMergeTargets(
    parsed.data.keeperId,
    parsed.data.merge.map((entry) => entry.id),
  );
  if ("error" in targets) return { error: dict[targets.error] };
  const { keeperId, mergeIds } = targets;

  let loaded: Awaited<ReturnType<typeof loadMergeItems>>;
  try {
    loaded = await loadMergeItems(household.id, keeperId, mergeIds);
  } catch (error) {
    return toFriendlyError(error);
  }
  if (!loaded) return { error: dict.notFound };
  const { keeper } = loaded;
  const merged = loaded.merged.map(({ item }) => item);
  const typedFactors = new Map(
    parsed.data.merge.flatMap((entry) => (entry.factor === undefined ? [] : [[entry.id, entry.factor] as const])),
  );
  const { plan, missingFactor, badFactor } = planMerge(keeper, merged, typedFactors);
  if (badFactor.length > 0) return { error: dict.factorRange };
  if (missingFactor.length > 0) return { error: dict.needsFactor };

  try {
    await prisma.$transaction(async (tx) => {
      // Only if every item's stock and unit are still what the plan was
      // made from, like "Change unit…": a +/- tap in between would
      // otherwise be lost or converted wrongly.
      const keeperUpdated = await tx.inventoryItem.updateMany({
        where: { id: keeper.id, householdId: household.id, quantity: keeper.quantity, unit: keeper.unit },
        data: {
          quantity: plan.quantity,
          lowStockThreshold: plan.lowStockThreshold,
          lastKnownPrice: plan.lastKnownPrice,
          expiresAt: plan.expiresAt,
          expiresAtEstimated: plan.expiresAtEstimated,
          category: plan.category,
          updatedByUserId: userId,
        },
      });
      if (keeperUpdated.count === 0) throw new MergeStockChanged();

      // Barcode: cleared on the merged items first, because of
      // @@unique([householdId, barcode]), then given to the keeper if it
      // had none.
      await tx.inventoryItem.updateMany({
        where: { id: { in: mergeIds }, householdId: household.id, barcode: { not: null } },
        data: { barcode: null },
      });
      if (plan.fromMerged.barcode) {
        await tx.inventoryItem.update({ where: { id: keeper.id }, data: { barcode: plan.barcode } });
      }

      if (plan.conversions.length > 0) {
        await tx.itemUnitConversion.createMany({
          data: plan.conversions.map((conversion) => ({ inventoryItemId: keeper.id, ...conversion })),
          skipDuplicates: true,
        });
      }

      // Pending rows on the same list: add a merged row into the keeper's
      // when the units convert (with the conversions just saved), before
      // re-pointing what's left.
      const pending = await tx.shoppingListItem.findMany({
        where: {
          inventoryItemId: { in: [keeper.id, ...mergeIds] },
          purchased: false,
          shoppingList: { householdId: household.id },
        },
        select: {
          id: true,
          shoppingListId: true,
          inventoryItemId: true,
          quantity: true,
          unit: true,
          estimatedPrice: true,
          note: true,
        },
        orderBy: { createdAt: "asc" },
      });
      const keeperConversions = [...keeper.conversions, ...plan.conversions];
      const rowMerge = planListRowMerges(pending, keeper.id, (quantity, from, to) =>
        convertBetweenUnits(quantity, from, to, keeper, keeperConversions),
      );
      if (rowMerge.deletes.length > 0) {
        await tx.shoppingListItem.deleteMany({ where: { id: { in: rowMerge.deletes } } });
      }
      for (const { id, ...data } of rowMerge.updates) await tx.shoppingListItem.update({ where: { id }, data });

      const moved = { inventoryItemId: { in: mergeIds } };
      const toKeeper = { inventoryItemId: keeper.id };
      await tx.recipeIngredient.updateMany({ where: { ...moved, recipe: { householdId: household.id } }, data: toKeeper });
      await tx.shoppingListItem.updateMany({
        where: { ...moved, shoppingList: { householdId: household.id } },
        data: toKeeper,
      });
      await tx.shoppingListTemplateItem.updateMany({
        where: { ...moved, template: { householdId: household.id } },
        data: toKeeper,
      });
      await tx.priceHistory.updateMany({ where: moved, data: toKeeper });
      await tx.itemAlias.updateMany({ where: { ...moved, householdId: household.id }, data: toKeeper });
      // The merged names, so the next import matches the keeper. A name
      // already learned (even as "Don't track") now means the keeper.
      for (const normalizedName of plan.aliases) {
        await tx.itemAlias.upsert({
          where: { householdId_normalizedName: { householdId: household.id, normalizedName } },
          create: { householdId: household.id, normalizedName, inventoryItemId: keeper.id },
          update: { inventoryItemId: keeper.id },
        });
      }
      // Stale alerts about items that no longer exist.
      await tx.notification.deleteMany({ where: { ...moved, householdId: household.id } });

      // The merged items' own conversions and "Not duplicates" rows go
      // with them (cascade).
      const deleted = await tx.inventoryItem.deleteMany({
        where: {
          householdId: household.id,
          OR: merged.map((item) => ({ id: item.id, quantity: item.quantity, unit: item.unit })),
        },
      });
      if (deleted.count !== merged.length) throw new MergeStockChanged();
    });
  } catch (error) {
    if (error instanceof MergeStockChanged) return { error: dict.stockChanged };
    return toFriendlyError(error);
  }

  revalidateCatalog();
  revalidateItem(keeper.id);
  revalidatePath("/dashboard/shopping-list", "layout");
  revalidatePath("/dashboard");
  return {};
}
