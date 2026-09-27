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

// The item page's writes (MATCH-6, design §6.1): an item's unit
// conversions, "Change unit…" and removing a learned alias. Every one
// checks the item (or the alias) against the session's household first;
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
