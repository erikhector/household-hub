// The household's always-on default shopping list ("Next shop", AUTO-8) and
// the low-stock auto-add that fills it.
//
// Before this, restocking depended on someone remembering to press "Add
// low-stock items" on some list, and the app had no notion of *the* list —
// markItemEmptyAction just guessed the most recently created ACTIVE one. Now
// every household has (lazily) exactly one ACTIVE list flagged `isDefault`,
// and any item crossing from in-stock into low/out of stock lands on it by
// itself, marked `addedAutomatically`. Other named lists (the big monthly
// trip) are untouched by any of this.
//
// Like recordOutOfStockTransition (src/lib/notifications.ts), which it sits
// beside at every call site: callers must resolve `householdId` from their
// own requireHousehold() (or, for the share-link path, the share token's
// list) first — this trusts its argument. Takes a `db` so callers already
// inside a $transaction (togglePurchasedAction, markMealEntryCookedAction)
// can pass their `tx` and keep the add atomic with the quantity change.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { getStockStatus } from "@/lib/stock-status";
import { coveredQuantity, loadIncomingByItem, loadIncomingQuantity } from "@/lib/incoming-stock";

type DbClient = typeof prisma | Prisma.TransactionClient;

// What an auto-add hands back to the client so it can show the "Added X to
// Next shop" toast, and so that toast's Undo can remove exactly the row that
// was created (see undoAutoAddedItemsAction in
// src/app/dashboard/shopping-list/actions.ts) — never "whatever is on the
// list for this item", which could be a row a person added by hand.
export type AutoAddedItem = {
  shoppingListItemId: string;
  listId: string;
  listName: string;
  itemName: string;
};

/**
 * Returns the household's ACTIVE default list, creating it if there isn't
 * one yet. Lazy on purpose: a household that never runs low on anything
 * never gets an empty list it didn't ask for (the one exception is
 * completing the default list, which starts the next one straight away —
 * see completeShoppingListAction).
 *
 * The create is `createMany({ skipDuplicates })` — i.e. `INSERT … ON
 * CONFLICT DO NOTHING` — against the partial unique index from this
 * feature's migration (one ACTIVE `isDefault` row per household), followed
 * by a re-read. Two concurrent first auto-adds (two members tapping − at
 * once) therefore converge on one list instead of one of them failing, and
 * unlike catching a P2002 this also works inside an interactive
 * transaction, where a failed statement would abort the whole transaction.
 */
export async function getOrCreateDefaultShoppingList(db: DbClient, householdId: string) {
  const where = { householdId, isDefault: true, status: "ACTIVE" as const };
  const existing = await db.shoppingList.findFirst({ where });
  if (existing) return existing;

  const dict = await getDictionary();
  await db.shoppingList.createMany({
    data: [{ householdId, name: dict.shoppingList.defaultListName, isDefault: true }],
    skipDuplicates: true,
  });
  const created = await db.shoppingList.findFirst({ where });
  // Only reachable if the index and this query ever disagree about what
  // "the active default" means — fail loudly rather than silently skipping
  // the add.
  if (!created) throw new Error("Default shopping list could not be created");
  return created;
}

type ListableItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  lowStockThreshold: number;
  lastKnownPrice: number | null;
};

/**
 * Puts an inventory item on the default list unless it's already pending
 * there — the same dedupe generateFromLowStockAction uses (an unpurchased
 * row linked to the same inventory item), so repeated triggers never pile up
 * duplicate rows. Returns the row it created, or `null` when it deduped.
 * Quantity is the same `max(1, threshold − quantity)` top-up as "Add
 * low-stock items" (AUTO-10's learned usual quantity can replace it later).
 */
export async function addItemToDefaultList(
  db: DbClient,
  householdId: string,
  item: ListableItem,
  addedAutomatically: boolean,
): Promise<{ list: { id: string; name: string }; created: AutoAddedItem | null }> {
  const list = await getOrCreateDefaultShoppingList(db, householdId);

  const alreadyOnList = await db.shoppingListItem.findFirst({
    where: { shoppingListId: list.id, purchased: false, inventoryItemId: item.id },
    select: { id: true },
  });
  if (alreadyOnList) return { list, created: null };

  const row = await db.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      inventoryItemId: item.id,
      name: item.name,
      quantity: Math.max(1, item.lowStockThreshold - item.quantity),
      unit: item.unit,
      addedAutomatically,
      // AUTO-4: same last-known-price default as every other add path.
      estimatedPrice: item.lastKnownPrice ?? undefined,
    },
    select: { id: true },
  });

  return {
    list,
    created: { shoppingListItemId: row.id, listId: list.id, listName: list.name, itemName: item.name },
  };
}

/**
 * Batch sibling of addItemToDefaultList for the inventory bulk "Add to
 * shopping list" (PERF-18): the default list (get-or-create), one read of
 * what's already pending and one createMany, so up to 200 items cost the same
 * handful of round trips as one. Same dedupe and sizing as the single-item
 * version. `added` counts the rows created; the rest were already pending.
 */
export async function addItemsToDefaultList(
  db: DbClient,
  householdId: string,
  items: readonly ListableItem[],
  addedAutomatically: boolean,
): Promise<{ list: { id: string; name: string }; added: number }> {
  const list = await getOrCreateDefaultShoppingList(db, householdId);
  if (items.length === 0) return { list, added: 0 };

  const pending = await db.shoppingListItem.findMany({
    where: { shoppingListId: list.id, purchased: false, inventoryItemId: { in: items.map((i) => i.id) } },
    select: { inventoryItemId: true },
  });
  const alreadyPending = new Set(pending.map((row) => row.inventoryItemId));
  const toAdd = items.filter((item) => !alreadyPending.has(item.id));
  if (toAdd.length === 0) return { list, added: 0 };

  await db.shoppingListItem.createMany({
    data: toAdd.map((item) => ({
      shoppingListId: list.id,
      inventoryItemId: item.id,
      name: item.name,
      quantity: Math.max(1, item.lowStockThreshold - item.quantity),
      unit: item.unit,
      addedAutomatically,
      estimatedPrice: item.lastKnownPrice ?? undefined,
    })),
  });
  return { list, added: toAdd.length };
}

/**
 * Sibling of recordOutOfStockTransition, called from exactly the same call
 * sites (every action that can decrease an existing item's quantity, right
 * after writing the new value) so every path — +/- tap, mark empty, edit
 * form, bulk edit, AI shelf scan, mark meal as cooked, un-checking a
 * shopping-list row — is covered once, in the actions layer, rather than per
 * UI. Where that helper only fires on the crossing to 0, this one fires on
 * the crossing *out of "in stock"*, into low or out, using the same
 * getStockStatus predicate as the badges. An item that was already low and
 * drops further (low → lower, low → out) is deliberately a no-op: it either
 * went on the list at its first crossing, or someone took it off on
 * purpose, and re-adding it on every tap would fight them.
 *
 * Reads the item's threshold after the caller's update, so an edit that
 * changes quantity and threshold together is judged against the new
 * threshold on both sides — i.e. only a quantity *drop* can trigger an add,
 * never raising the threshold alone.
 *
 * Stock that's ticked off but not yet put away (src/lib/incoming-stock.ts)
 * counts as covered on both sides of the change: milk sitting in the cart
 * while the last carton at home is used up is not a reason to put milk back
 * on the list. The ticked row itself doesn't satisfy the "already pending"
 * dedupe below (it's purchased), which is exactly why this has to.
 *
 * Returns what it added (for the toast's Undo), or `null` when nothing was:
 * no crossing, the household turned auto-add off, or the item was already
 * pending on the default list.
 */
export async function addToDefaultListOnLowStock(
  db: DbClient,
  householdId: string,
  itemId: string,
  previousQuantity: number,
  nextQuantity: number,
): Promise<AutoAddedItem | null> {
  // Cheap early-out before any query: most calls are restocks or no-ops.
  if (nextQuantity >= previousQuantity) return null;

  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, householdId },
    select: { id: true, name: true, unit: true, quantity: true, lowStockThreshold: true, lastKnownPrice: true },
  });
  if (!item) return null;

  const incoming = await loadIncomingQuantity(db, householdId, itemId);
  const crossed =
    getStockStatus(coveredQuantity(previousQuantity, incoming), item.lowStockThreshold) === "in" &&
    getStockStatus(coveredQuantity(nextQuantity, incoming), item.lowStockThreshold) !== "in";
  if (!crossed) return null;

  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { autoAddLowStockToList: true },
  });
  if (!household?.autoAddLowStockToList) return null;

  const { created } = await addItemToDefaultList(db, householdId, item, true);
  return created;
}

/**
 * Batch sibling of addToDefaultListOnLowStock for the AI shelf scan's "take
 * stock" (bulkSetInventoryQuantitiesAction). Same crossing rule (in stock ->
 * low/out, judged on stock plus what's on its way), but a fixed number of
 * queries however many items changed: one incoming-stock read, the household
 * flag, the default list (get-or-create), one read of what's already pending
 * and one createManyAndReturn. Nothing is queried when no item decreased.
 *
 * Callers pass the rows they already loaded (threshold, unit, price) rather
 * than this re-reading them, and `quantity` on each is the *previous* count;
 * the list quantity is topped up from `nextQuantity` exactly as the
 * single-item version does after the caller's update. Results come back in
 * input order, one per item actually added.
 */
export async function addToDefaultListOnLowStockBatch(
  db: DbClient,
  householdId: string,
  changes: readonly { item: ListableItem; previousQuantity: number; nextQuantity: number }[],
): Promise<AutoAddedItem[]> {
  const decreased = changes.filter((c) => c.nextQuantity < c.previousQuantity);
  if (decreased.length === 0) return [];

  const [incoming, household] = await Promise.all([
    loadIncomingByItem(db, householdId, new Date(), decreased.map((c) => c.item.id)),
    db.household.findUnique({ where: { id: householdId }, select: { autoAddLowStockToList: true } }),
  ]);
  if (!household?.autoAddLowStockToList) return [];

  const crossed = decreased.filter((c) => {
    const covered = incoming.get(c.item.id) ?? 0;
    return (
      getStockStatus(coveredQuantity(c.previousQuantity, covered), c.item.lowStockThreshold) === "in" &&
      getStockStatus(coveredQuantity(c.nextQuantity, covered), c.item.lowStockThreshold) !== "in"
    );
  });
  if (crossed.length === 0) return [];

  const list = await getOrCreateDefaultShoppingList(db, householdId);
  const pending = await db.shoppingListItem.findMany({
    where: { shoppingListId: list.id, purchased: false, inventoryItemId: { in: crossed.map((c) => c.item.id) } },
    select: { inventoryItemId: true },
  });
  const alreadyPending = new Set(pending.map((row) => row.inventoryItemId));
  const toAdd = crossed.filter((c) => !alreadyPending.has(c.item.id));
  if (toAdd.length === 0) return [];

  const rows = await db.shoppingListItem.createManyAndReturn({
    data: toAdd.map(({ item, nextQuantity }) => ({
      shoppingListId: list.id,
      inventoryItemId: item.id,
      name: item.name,
      quantity: Math.max(1, item.lowStockThreshold - nextQuantity),
      unit: item.unit,
      addedAutomatically: true,
      estimatedPrice: item.lastKnownPrice ?? undefined,
    })),
    select: { id: true, inventoryItemId: true },
  });
  const rowByItem = new Map(rows.map((row) => [row.inventoryItemId, row.id]));
  return toAdd.flatMap(({ item }) => {
    const shoppingListItemId = rowByItem.get(item.id);
    return shoppingListItemId
      ? [{ shoppingListItemId, listId: list.id, listName: list.name, itemName: item.name }]
      : [];
  });
}

// Every caller revalidates its own pages already; this adds the list pages
// an auto-add just changed, so "Next shop" is fresh the next time someone
// opens it from another tab or device. Called after (never inside) the
// caller's transaction.
export function revalidateAutoAdded(autoAdded: readonly (AutoAddedItem | null)[]) {
  const listIds = new Set(autoAdded.flatMap((added) => (added ? [added.listId] : [])));
  if (listIds.size === 0) return;
  for (const listId of listIds) revalidatePath(`/dashboard/shopping-list/${listId}`);
  revalidatePath("/dashboard/shopping-list");
}
