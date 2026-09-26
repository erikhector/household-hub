// Loads the purchase history AUTO-10's repurchase-calc.ts works from. Kept
// apart from the pure calc so that stays testable without a database, and
// apart from the shopping-list page/actions so the only edits there are the
// call sites.
//
// Callers must resolve `householdId` from their own requireHousehold() first
// — this trusts its argument, same as src/lib/shopping/default-list.ts.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  HISTORY_WINDOW_DAYS,
  getRepurchaseSuggestions,
  purchaseTimestamp,
  repurchaseRhythm,
  type RepurchaseCandidate,
  type RepurchaseRhythm,
} from "@/lib/inventory/repurchase-calc";

const DAY_MS = 24 * 60 * 60 * 1000;

// A purchased row inside the history window, dated either way
// purchaseTimestamp() accepts: ticked by hand, or on a list that was
// completed (receipt apply / "Register receipt" rows, and every row ticked
// before AUTO-9 added checkedOffAt).
function purchasedSince(since: Date): Prisma.ShoppingListItemWhereInput {
  return {
    purchased: true,
    OR: [{ checkedOffAt: { gte: since } }, { checkedOffAt: null, shoppingList: { completedAt: { gte: since } } }],
  };
}

const purchaseSelect = {
  inventoryItemId: true,
  purchased: true,
  checkedOffAt: true,
  shoppingList: { select: { completedAt: true } },
} satisfies Prisma.ShoppingListItemSelect;

function toPurchaseDate(row: {
  purchased: boolean;
  checkedOffAt: Date | null;
  shoppingList: { completedAt: Date | null };
}): Date | null {
  return purchaseTimestamp({
    purchased: row.purchased,
    checkedOffAt: row.checkedOffAt,
    listCompletedAt: row.shoppingList.completedAt,
  });
}

/**
 * Up to MAX_REPURCHASE_SUGGESTIONS items the household usually buys about
 * now. Two queries, whatever the household's size: the dated purchase
 * history, and what's already on an ACTIVE list.
 *
 * "Already pending" is wider than an un-ticked row: a row on an ACTIVE list
 * that's ticked but undated (receipt-applied, waiting for the list to be
 * completed — see purchaseTimestamp) was just bought, but its date doesn't
 * exist yet, so without this the item would look overdue on its old last
 * purchase. Ticked-by-hand rows on an active list need no such rule: their
 * checkedOffAt is recent, so the calc already sees a fresh purchase.
 */
export async function loadRepurchaseSuggestions(householdId: string, now: Date) {
  const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);

  const [purchaseRows, onActiveLists] = await Promise.all([
    prisma.shoppingListItem.findMany({
      where: {
        inventoryItemId: { not: null },
        shoppingList: { householdId },
        ...purchasedSince(since),
      },
      select: {
        ...purchaseSelect,
        inventoryItem: { select: { name: true, repurchaseSnoozedUntil: true } },
      },
    }),
    prisma.shoppingListItem.findMany({
      where: {
        inventoryItemId: { not: null },
        shoppingList: { householdId, status: "ACTIVE" },
        OR: [{ purchased: false }, { purchased: true, checkedOffAt: null }],
      },
      select: { inventoryItemId: true },
    }),
  ]);

  const candidates = new Map<string, RepurchaseCandidate>();
  for (const row of purchaseRows) {
    const at = toPurchaseDate(row);
    if (!row.inventoryItemId || !row.inventoryItem || !at) continue;
    let candidate = candidates.get(row.inventoryItemId);
    if (!candidate) {
      candidate = {
        inventoryItemId: row.inventoryItemId,
        name: row.inventoryItem.name,
        snoozedUntil: row.inventoryItem.repurchaseSnoozedUntil,
        purchases: [],
      };
      candidates.set(row.inventoryItemId, candidate);
    }
    candidate.purchases.push(at);
  }

  return getRepurchaseSuggestions({
    candidates: [...candidates.values()],
    pendingInventoryItemIds: new Set(onActiveLists.flatMap((row) => (row.inventoryItemId ? [row.inventoryItemId] : []))),
    now,
  });
}

/** One item's rhythm — what dismissing needs to know how long to snooze. */
export async function loadRepurchaseRhythm(
  householdId: string,
  inventoryItemId: string,
  now: Date,
): Promise<RepurchaseRhythm | null> {
  const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.shoppingListItem.findMany({
    where: { inventoryItemId, shoppingList: { householdId }, ...purchasedSince(since) },
    select: purchaseSelect,
  });
  return repurchaseRhythm(rows.flatMap((row) => toPurchaseDate(row) ?? []));
}
