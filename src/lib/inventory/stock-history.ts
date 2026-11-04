import type { Prisma } from "@/generated/prisma/client";
import type { prisma } from "@/lib/prisma";

// GAP-66: the append-only journal behind the item page's "History". Every
// action that changes an item's quantity calls this right beside
// recordOutOfStockTransition, with the same previous/next pair it already
// has, so "every change goes through the hooks once" stays one rule.
//
// Why the reason is a plain string column and not a Prisma enum: the set is
// small and this table is a log, so adding a reason later shouldn't need a
// migration. STOCK_EVENT_REASONS is the one list the writers and the page
// share.
export const STOCK_EVENT_REASONS = ["used", "restocked", "adjusted", "cooked", "trip"] as const;
export type StockEventReason = (typeof STOCK_EVENT_REASONS)[number];

// How many events an item keeps. Old ones fall off the end as new ones are
// written, so the table can't grow without bound for a +/- happy household.
export const STOCK_HISTORY_CAP = 50;

type DbClient = typeof prisma | Prisma.TransactionClient;

export type StockChange = {
  householdId: string;
  itemId: string;
  // The session user's id from requireHousehold(), never one from the
  // client. Optional because a few callers (a shared-list tick) can lack it.
  userId?: string | null;
  previousQuantity: number;
  nextQuantity: number;
  reason: StockEventReason;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

// +/- taps and scans: a decrease is "used", an increase "restocked".
export function reasonForDelta(delta: number): StockEventReason {
  return delta < 0 ? "used" : "restocked";
}

// Writes one event per changed item (a change that leaves the quantity where
// it was, e.g. "-1" on an item already at 0, writes nothing), then trims
// each touched item back to the newest STOCK_HISTORY_CAP. The trim reads the
// ids newest-first and deletes whatever is past the cap, so it costs a
// fixed two queries however many items the batch touches (a shelf scan can
// change hundreds).
export async function recordStockEvents(db: DbClient, changes: readonly StockChange[]): Promise<void> {
  const rows = changes
    .map((change) => ({
      itemId: change.itemId,
      householdId: change.householdId,
      userId: change.userId ?? null,
      delta: round2(change.nextQuantity - change.previousQuantity),
      reason: change.reason,
    }))
    .filter((row) => row.delta !== 0);
  if (rows.length === 0) return;

  await db.inventoryItemEvent.createMany({ data: rows });

  const itemIds = [...new Set(rows.map((row) => row.itemId))];
  const kept = new Map<string, number>();
  const surplus: string[] = [];
  const existing = await db.inventoryItemEvent.findMany({
    where: { itemId: { in: itemIds } },
    orderBy: [{ itemId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { id: true, itemId: true },
  });
  for (const event of existing) {
    const seen = (kept.get(event.itemId) ?? 0) + 1;
    kept.set(event.itemId, seen);
    if (seen > STOCK_HISTORY_CAP) surplus.push(event.id);
  }
  if (surplus.length > 0) await db.inventoryItemEvent.deleteMany({ where: { id: { in: surplus } } });
}

export function recordStockEvent(db: DbClient, change: StockChange): Promise<void> {
  return recordStockEvents(db, [change]);
}
