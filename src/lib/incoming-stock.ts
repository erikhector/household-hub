// "Incoming" stock: shopping-list rows that were ticked off (in the cart, or
// in the bags on the way home) but haven't been put away yet — see
// ShoppingListItem.putAwayAt in prisma/schema.prisma and "Put away" in
// REQUIREMENTS.md. For a household in the two-phase ON_PUT_AWAY mode the
// tick no longer touches inventory, so for a while the pantry honestly says
// "0 milk" while two cartons sit in the trolley. Everything that *reacts* to
// a low count (AUTO-8's auto-add, "Add low-stock items", the out-of-stock
// alert) has to count those cartons as covered, or it would put milk straight
// back on the list — or buzz everyone's phone about it — mid-shop.
//
// The display itself (stock badge, filters) deliberately stays on the real
// count: it isn't home yet. The inventory page shows the difference as a
// small "+N on the way" hint instead.
//
// The pure half (isIncoming, sumIncomingByItem, coveredQuantity) is
// unit-tested; loadIncomingByItem is the one query every caller shares, so
// the "what counts" rule is written once for the database and once for the
// rows it returns. It takes a `db` so callers already inside a $transaction
// can pass their `tx`, like addToDefaultListOnLowStock. Callers must resolve
// `householdId` from their own requireHousehold() (or, for the share link,
// the token's list) first — this trusts its argument.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

// A ticked row nobody put away within a week was put away without telling
// the app (or never came home). Counting it forever would quietly stop that
// item from ever being auto-added again, which is a far worse failure than
// the one this module exists to prevent — so after this it stops counting.
// It stays put-away-able from the list's dialog; this only limits how long
// it holds off the low-stock logic.
export const INCOMING_MAX_AGE_DAYS = 7;

export type IncomingRow = {
  inventoryItemId: string | null;
  quantity: number;
  purchased: boolean;
  putAwayAt: Date | null;
  checkedOffAt: Date | null;
  priceRecordedAt: Date | null;
  listStatus: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  listCompletedAt: Date | null;
};

/**
 * Ticked, not yet put away, linked, on a list that's still in play (an
 * archived list was abandoned, so whatever's on it isn't coming), and fresh
 * enough (see INCOMING_MAX_AGE_DAYS). See incomingSince for how a row is
 * dated. A row with no date at all doesn't count: every path that leaves a
 * row waiting stamps one, so an undated row is stray data, and the safe way
 * for it to fail is to let the low-stock logic act rather than hold it off
 * with no time limit.
 */
export function isIncoming(row: IncomingRow, now: Date): boolean {
  if (!row.purchased || row.putAwayAt !== null || row.inventoryItemId === null) return false;
  if (row.listStatus === "ARCHIVED") return false;
  if (row.quantity <= 0) return false;
  const dated = incomingSince(row);
  if (dated === null) return false;
  return now.getTime() - dated.getTime() <= INCOMING_MAX_AGE_DAYS * DAY_MS;
}

/**
 * When a waiting row started waiting: its tick, else when a receipt priced it
 * (a receipt applied in put-away mode marks rows bought without a tick —
 * see applyReceiptScanAction), else its list's completion. Shared with the
 * put-away reminder so both agree on how old a trip is.
 */
export function incomingSince(row: {
  checkedOffAt: Date | null;
  priceRecordedAt: Date | null;
  listCompletedAt?: Date | null;
}): Date | null {
  return row.checkedOffAt ?? row.priceRecordedAt ?? row.listCompletedAt ?? null;
}

/** Incoming quantity per inventory item id; items with none are absent. */
export function sumIncomingByItem(rows: readonly IncomingRow[], now: Date): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!isIncoming(row, now)) continue;
    const id = row.inventoryItemId!;
    // Rounded like nextQuantityAfterDelta, so 0.1 + 0.2 kg reads as 0.3.
    totals.set(id, Math.round(((totals.get(id) ?? 0) + row.quantity) * 100) / 100);
  }
  return totals;
}

/**
 * What the low-stock logic should judge: stock at home plus stock on its
 * way. Every caller compares the *covered* amount against the threshold on
 * both sides of a change, so the incoming amount shifts both equally and a
 * pure decrease is still a decrease.
 */
export function coveredQuantity(quantity: number, incoming: number): number {
  return quantity + Math.max(0, incoming);
}

/**
 * Loads incoming rows for the household (optionally just some items) and
 * sums them. The `where` narrows to roughly the same set isIncoming accepts
 * so the query stays small; isIncoming then makes the exact call.
 */
export async function loadIncomingByItem(
  db: DbClient,
  householdId: string,
  now: Date,
  inventoryItemIds?: readonly string[],
): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - INCOMING_MAX_AGE_DAYS * DAY_MS);
  const rows = await db.shoppingListItem.findMany({
    where: {
      purchased: true,
      putAwayAt: null,
      inventoryItemId: inventoryItemIds ? { in: [...inventoryItemIds] } : { not: null },
      shoppingList: { householdId, status: { in: ["ACTIVE", "COMPLETED"] } },
      // The database half of incomingSince: dated by the first of these
      // that's set, and recent enough.
      OR: [
        { checkedOffAt: { gte: since } },
        { checkedOffAt: null, priceRecordedAt: { gte: since } },
        { checkedOffAt: null, priceRecordedAt: null, shoppingList: { completedAt: { gte: since } } },
      ],
    },
    select: {
      inventoryItemId: true,
      quantity: true,
      purchased: true,
      putAwayAt: true,
      checkedOffAt: true,
      priceRecordedAt: true,
      shoppingList: { select: { status: true, completedAt: true } },
    },
  });
  return sumIncomingByItem(
    rows.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      quantity: row.quantity,
      purchased: row.purchased,
      putAwayAt: row.putAwayAt,
      checkedOffAt: row.checkedOffAt,
      priceRecordedAt: row.priceRecordedAt,
      listStatus: row.shoppingList.status,
      listCompletedAt: row.shoppingList.completedAt,
    })),
    now,
  );
}

/** Single-item convenience for the per-change hooks. */
export async function loadIncomingQuantity(
  db: DbClient,
  householdId: string,
  inventoryItemId: string,
  now: Date = new Date(),
): Promise<number> {
  const totals = await loadIncomingByItem(db, householdId, now, [inventoryItemId]);
  return totals.get(inventoryItemId) ?? 0;
}
