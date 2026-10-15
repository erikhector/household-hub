import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";

// GAP-47: the item page's "Recent prices" — an item's last purchases from
// PriceHistory, which purchases and receipt scans already write (see
// recordPriceSpikes in src/lib/notifications.ts). No schema change: this is
// only a household-scoped read.
//
// Scoping goes through the item (`inventoryItem.householdId`), since a
// PriceHistory row has no household column of its own; the household comes
// from the session, never from the caller, so an item id from another
// household simply matches nothing.
export const RECENT_PRICES_LIMIT = 10;

export type RecentPrice = {
  id: string;
  date: Date;
  store: string | null;
  // What the whole purchased line cost, in the base currency.
  price: number;
  // The line's quantity and unit, null on rows from before GAP-9.
  quantity: number | null;
  unit: string | null;
  // price / quantity, or null when the row can't be put on a per-unit
  // footing (no quantity recorded) — the UI then shows the line price only.
  unitPrice: number | null;
};

// Same per-unit definition as price-spike.ts: the line price over the line's
// quantity. A missing, zero or negative quantity gives no per-unit price
// rather than Infinity/NaN.
export function perUnitPrice(price: number, quantity: number | null): number | null {
  if (quantity === null || !(quantity > 0)) return null;
  return price / quantity;
}

// Newest first; ties (two lines on one receipt) fall back to the id so the
// order is stable between renders.
export async function getRecentPrices(inventoryItemId: string): Promise<RecentPrice[]> {
  const { household } = await requireHousehold();
  const rows = await prisma.priceHistory.findMany({
    where: { inventoryItemId, inventoryItem: { householdId: household.id } },
    select: { id: true, date: true, store: true, price: true, quantity: true, unit: true },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: RECENT_PRICES_LIMIT,
  });
  return rows.map((row) => ({ ...row, unitPrice: perUnitPrice(row.price, row.quantity) }));
}
