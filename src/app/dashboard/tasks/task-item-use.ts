import type { Prisma } from "@/generated/prisma/client";
import { recordOutOfStockTransition } from "@/lib/notifications";
import { recordStockEvent } from "@/lib/inventory/stock-history";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";
import { addToDefaultListOnLowStock, type AutoAddedItem } from "@/lib/shopping/default-list";

// GAP-87: a task can use up a pantry item when it's ticked ("Run the
// dishwasher" uses 1 dishwasher tablet), so consumables run low and reach
// "Next shop" through the same low-stock path as a -1 tap, without anyone
// typing it. Both halves run inside toggleTaskCompletedAction's transaction,
// and only after its compare-and-set completion write matched, so a double
// tap or two members ticking at once use the item up once.
//
// The tick's `used` event carries the task's id, and un-ticking reverses
// that event's own delta rather than the task's quantity: when stock hit 0
// the tick used less than asked, and the reversal must not invent stock.
// Matching on the id (not on "the latest used event" or a timestamp) means a
// cook or a manual -1 made after the tick is never undone by mistake.
//
// Only the *current* completion's event stays linked. A tick first unlinks
// any older one, and an un-tick unlinks the one it reversed, so a later
// un-tick can't reach back to a previous completion's event (a repeating
// task ticked again at 0 stock writes no event of its own).
// Plain module, not "use server": these take a transaction client.

type Tx = Prisma.TransactionClient;

/** What a tick took off the shelf, for the "Used 1 pcs Dishwasher tablets" toast. */
export type TaskItemUse = { itemName: string; quantity: number; unit: string };

const round2 = (value: number) => Math.round(value * 100) / 100;

function unlinkTaskEvents(tx: Tx, householdId: string, taskId: string) {
  return tx.inventoryItemEvent.updateMany({ where: { taskId, householdId }, data: { taskId: null } });
}

/**
 * The tick half: takes `quantity` of the linked item off, never below 0.
 * The item is re-read within the session household, so a link that somehow
 * points elsewhere uses nothing. Returns null when nothing was used (no
 * link, the item is gone, or it was already at 0).
 */
export async function consumeTaskItem(
  tx: Tx,
  input: { householdId: string; userId: string; taskId: string; itemId: string | null; quantity: number | null },
): Promise<{ used: TaskItemUse | null; autoAdded: AutoAddedItem | null }> {
  const { householdId, userId, taskId, itemId, quantity } = input;
  await unlinkTaskEvents(tx, householdId, taskId);
  const nothing = { used: null, autoAdded: null };
  if (!itemId || !quantity || quantity <= 0) return nothing;

  const item = await tx.inventoryItem.findFirst({
    where: { id: itemId, householdId },
    select: { id: true, name: true, unit: true, quantity: true },
  });
  if (!item) return nothing;

  const nextQuantity = nextQuantityAfterDelta(item.quantity, -quantity);
  if (nextQuantity === item.quantity) return nothing;

  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { quantity: nextQuantity, updatedByUserId: userId },
  });
  await recordOutOfStockTransition(tx, householdId, item.id, item.quantity, nextQuantity, userId);
  await recordStockEvent(tx, {
    householdId,
    itemId: item.id,
    userId,
    previousQuantity: item.quantity,
    nextQuantity,
    reason: "used",
    taskId,
  });
  const autoAdded = await addToDefaultListOnLowStock(tx, householdId, item.id, item.quantity, nextQuantity);
  return {
    used: { itemName: item.name, quantity: round2(item.quantity - nextQuantity), unit: item.unit },
    autoAdded,
  };
}

/**
 * The un-tick half: puts back what this task's latest `used` event took,
 * on whichever item that event was for (the link may have changed since).
 * Returns whether any stock moved, so the caller knows to refresh the
 * inventory pages.
 */
export async function restoreTaskItem(
  tx: Tx,
  input: { householdId: string; userId: string; taskId: string },
): Promise<boolean> {
  const { householdId, userId, taskId } = input;
  const event = await tx.inventoryItemEvent.findFirst({
    where: { taskId, householdId, reason: "used" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { itemId: true, delta: true },
  });
  await unlinkTaskEvents(tx, householdId, taskId);
  if (!event || event.delta >= 0) return false;

  const item = await tx.inventoryItem.findFirst({
    where: { id: event.itemId, householdId },
    select: { id: true, quantity: true },
  });
  if (!item) return false;

  const nextQuantity = nextQuantityAfterDelta(item.quantity, -event.delta);
  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { quantity: nextQuantity, ...(nextQuantity > 0 ? { everStocked: true } : {}), updatedByUserId: userId },
  });
  await recordStockEvent(tx, {
    householdId,
    itemId: item.id,
    userId,
    previousQuantity: item.quantity,
    nextQuantity,
    reason: "adjusted",
  });
  // The tick may have raised an "Out of stock" in the bell; with the stock
  // back it's just noise (same as undoMarkItemEmptyAction).
  if (item.quantity <= 0 && nextQuantity > 0) {
    await tx.notification.updateMany({
      where: { householdId, inventoryItemId: item.id, kind: "OUT_OF_STOCK", dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
  }
  return true;
}
