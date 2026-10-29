"use server";

// AUTO-10's chip actions — "You usually buy this about now" (see
// src/lib/inventory/repurchase-calc.ts). In their own file rather than
// actions.ts so the feature stays out of the busiest file in the app; same
// split as share-actions.ts. Nothing here runs unless someone taps a chip:
// suggestions are never added by themselves and never notify (BACKLOG.md's
// Guardrails).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { repurchaseSnoozeUntil } from "@/lib/inventory/repurchase-calc";
import { loadRepurchaseRhythm } from "@/lib/inventory/repurchase-suggestions";
import { defaultLineEstimate } from "@/lib/shopping/unit-price";

/**
 * One tap on a chip: puts the item on the list being viewed. The amount is
 * whatever the household bought last time (the newest purchased row's
 * quantity and unit) — the closest thing to "the usual" without a separate
 * learned quantity (AUTO-8's future work) — falling back to 1 of the item's
 * own unit. Idempotent: if the item is already pending on this list (a
 * double tap, or another member added it meanwhile) nothing is created.
 * Not `addedAutomatically` — a person chose it.
 */
export async function addRepurchaseSuggestionAction(
  listId: string,
  inventoryItemId: string,
): Promise<ActionState & { itemId?: string }> {
  const { household, userId } = await requireHousehold();

  const [list, inventoryItem] = await Promise.all([
    prisma.shoppingList.findFirst({
      where: { id: listId, householdId: household.id, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, householdId: household.id },
      select: { id: true, name: true, unit: true, lastKnownPrice: true },
    }),
  ]);
  if (!list) return await fail("listNotEditable");
  if (!inventoryItem) return await fail("itemNotFound");

  let itemId: string | undefined;
  try {
    const [alreadyPending, lastPurchase] = await Promise.all([
      prisma.shoppingListItem.findFirst({
        where: { shoppingListId: list.id, inventoryItemId: inventoryItem.id, purchased: false },
        select: { id: true },
      }),
      prisma.shoppingListItem.findFirst({
        where: { inventoryItemId: inventoryItem.id, purchased: true, shoppingList: { householdId: household.id } },
        orderBy: { createdAt: "desc" },
        select: { quantity: true, unit: true },
      }),
    ]);
    if (alreadyPending) return { itemId: alreadyPending.id };

    const created = await prisma.shoppingListItem.create({
      data: {
        shoppingListId: list.id,
        addedByUserId: userId,
        inventoryItemId: inventoryItem.id,
        name: inventoryItem.name,
        quantity: lastPurchase?.quantity ?? 1,
        unit: lastPurchase?.unit ?? inventoryItem.unit,
        // AUTO-4: same last-known-price default as every other add path.
        estimatedPrice: defaultLineEstimate(inventoryItem.lastKnownPrice, lastPurchase?.quantity ?? 1),
      },
      select: { id: true },
    });
    itemId = created.id;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return { itemId };
}

/**
 * The chip's ×: snoozes the item for one usual interval
 * (repurchaseSnoozeUntil), stored on the InventoryItem so it holds on every
 * member's device — the rhythm is re-read here rather than trusted from the
 * client. An item with no rhythm (history changed since the chip rendered)
 * has nothing to snooze and is left alone.
 */
export async function dismissRepurchaseSuggestionAction(inventoryItemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const now = new Date();

  try {
    const rhythm = await loadRepurchaseRhythm(household.id, inventoryItemId, now);
    if (!rhythm) return {};
    // updateMany so the household scope is part of the write itself — a
    // foreign id updates nothing.
    await prisma.inventoryItem.updateMany({
      where: { id: inventoryItemId, householdId: household.id },
      data: { repurchaseSnoozedUntil: repurchaseSnoozeUntil(rhythm.medianIntervalDays, now) },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return {};
}

/**
 * The dismiss toast's Undo (Guardrails: undo over confirm). Clearing is
 * safe because a chip is only ever shown for an item that isn't snoozed,
 * so there's no earlier snooze to restore.
 */
export async function undoDismissRepurchaseSuggestionAction(inventoryItemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.inventoryItem.updateMany({
      where: { id: inventoryItemId, householdId: household.id },
      data: { repurchaseSnoozedUntil: null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return {};
}
