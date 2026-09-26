// The inventory side of a shopping-list purchase, shared by every path that
// moves bought stock into (or back out of) the pantry: the tick itself in an
// ON_CHECK household (togglePurchasedAction and the share-link toggle), the
// put-away step in an ON_PUT_AWAY one (putAwayItemsAction), receipt apply,
// and un-ticking a row that had already been put away. Before the two-phase
// flow existed these side effects lived inline in each toggle; pulling them
// here is what keeps "stock arrived" meaning exactly the same thing whichever
// of those paths got there first.
//
// Like default-list.ts, this trusts `householdId` — callers resolve it from
// requireHousehold() (or the share token's list) first — and takes the
// caller's `tx`, so every write lands in the caller's one transaction.

import type { InventoryItem, Prisma } from "@/generated/prisma/client";
import { estimatedExpiryUpdate } from "@/lib/inventory/shelf-life";
import { openedResetOnArrival } from "@/lib/inventory/expiry";
import { recordOutOfStockTransition, type RecordedPrice } from "@/lib/notifications";
import { addToDefaultListOnLowStock, type AutoAddedItem } from "@/lib/shopping/default-list";

export type StockArrivalOptions = {
  householdId: string;
  /** The member whose action this is, excluded from the out-of-stock push. */
  actingUserId?: string;
  /** The inventory item as it stands right now (the caller's snapshot, or
   * the result of an earlier arrival in the same batch — see
   * putAwayItemsAction). */
  inventoryItem: InventoryItem;
  quantity: number;
  unit: string;
  /** Per-line price to record as PriceHistory + lastKnownPrice (AUTO-4,
   * GAP-9), or null to leave prices alone. */
  price: number | null;
  /** The quantity `price` was paid for, when that differs from what's
   * arriving — the put-away dialog's corrected quantity must not change the
   * unit price GAP-9 compares (price ÷ quantity), or a smaller-than-listed
   * delivery would look like a price jump. Defaults to `quantity`. */
  priceQuantity?: number;
  /** GAP-6: stamped on the PriceHistory row. */
  store?: string | null;
  /** A date the person typed in the put-away dialog. Real, so it's stored
   * unflagged and wins over AUTO-7's estimate. */
  expiresAt?: Date | null;
  /** Where the person put it (the put-away dialog's location field). */
  location?: string | null;
};

export type StockArrivalResult = {
  nextQuantity: number;
  /** The updated inventory row, for chaining several arrivals of the same
   * item inside one batch. */
  inventoryItem: InventoryItem;
  recordedPrice: RecordedPrice | null;
  autoAdded: AutoAddedItem | null;
};

/**
 * Stock arriving: increments the item, and applies everything a restock
 * means — AUTO-7's estimated expiry (only on the 0 → positive crossing or
 * when there's no date yet, and never over a real date), GAP-28's
 * opened-reset (a restock from zero is a fresh, sealed pack; spread before
 * the expiry patch so a new estimate wins over the cleared date), an
 * optional typed expiry/location, AUTO-4's lastKnownPrice and GAP-9's
 * PriceHistory row. The out-of-stock and AUTO-8 hooks run too, exactly as
 * every other quantity change does; on an increase both are no-ops, but
 * running them keeps "every change goes through the hooks once" true
 * without every caller having to know that.
 */
export async function applyStockArrival(
  tx: Prisma.TransactionClient,
  options: StockArrivalOptions,
): Promise<StockArrivalResult> {
  const { householdId, inventoryItem: current, quantity, price } = options;
  const previousQuantity = current.quantity;
  const nextQuantity = Math.max(0, previousQuantity + quantity);

  const openedReset = openedResetOnArrival(current, previousQuantity, nextQuantity);
  const expiryUpdate = options.expiresAt
    ? { expiresAt: options.expiresAt, expiresAtEstimated: false }
    : estimatedExpiryUpdate(current, previousQuantity, nextQuantity);
  const data = {
    quantity: nextQuantity,
    ...(price != null ? { lastKnownPrice: price } : {}),
    ...(options.location ? { location: options.location } : {}),
    ...openedReset,
    ...expiryUpdate,
  };
  await tx.inventoryItem.update({ where: { id: current.id }, data });

  await recordOutOfStockTransition(tx, householdId, current.id, previousQuantity, nextQuantity, options.actingUserId);
  const autoAdded = await addToDefaultListOnLowStock(tx, householdId, current.id, previousQuantity, nextQuantity);

  let recordedPrice: RecordedPrice | null = null;
  if (price != null) {
    const priceQuantity = options.priceQuantity ?? quantity;
    // GAP-9: the line's quantity/unit too, so the price can be compared per
    // unit later (see detectPriceSpike).
    const row = await tx.priceHistory.create({
      data: {
        inventoryItemId: current.id,
        price,
        quantity: priceQuantity,
        unit: options.unit,
        ...(options.store !== undefined ? { store: options.store } : {}),
      },
    });
    recordedPrice = {
      priceHistoryId: row.id,
      inventoryItemId: current.id,
      price,
      quantity: priceQuantity,
      unit: options.unit,
    };
  }

  return {
    nextQuantity,
    inventoryItem: { ...current, ...data } as InventoryItem,
    recordedPrice,
    autoAdded,
  };
}

/**
 * The reverse: un-ticking a row whose stock had already been counted
 * (putAwayAt set). Takes the quantity back out, floored at zero, and runs
 * the out-of-stock and AUTO-8 hooks — this is the one direction where they
 * can actually fire. Prices, expiry and the opened state are left alone:
 * none of them is wrong just because a tick was a mistake.
 */
export async function reverseStockArrival(
  tx: Prisma.TransactionClient,
  options: { householdId: string; actingUserId?: string; inventoryItem: InventoryItem; quantity: number },
): Promise<{ nextQuantity: number; autoAdded: AutoAddedItem | null }> {
  const { householdId, inventoryItem: current } = options;
  const nextQuantity = Math.max(0, current.quantity - options.quantity);
  await tx.inventoryItem.update({ where: { id: current.id }, data: { quantity: nextQuantity } });
  await recordOutOfStockTransition(tx, householdId, current.id, current.quantity, nextQuantity, options.actingUserId);
  const autoAdded = await addToDefaultListOnLowStock(tx, householdId, current.id, current.quantity, nextQuantity);
  return { nextQuantity, autoAdded };
}
