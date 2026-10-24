// BUG-3: `InventoryItem.lastKnownPrice` is the price of ONE of a shopping
// line's quantity (one carton, one pack), while a line's `estimatedPrice`
// is what the whole line costs (completeShoppingListAction sums it without
// multiplying by quantity). Two small conversions keep the two honest:
// every writer of lastKnownPrice divides the line price by the quantity it
// was paid for, and every create path that defaults a new row's estimate
// multiplies it back by that row's quantity. Without them a receipt line
// "3 x Milk 45,00" would make next week's "Milk x1" cost 45 instead of 15.
//
// Pure and Prisma-free so both directions are unit-tested in one place.

import { round2 } from "@/lib/math";

/** The price of one unit of a line's quantity: `linePrice` ÷ `quantity`.
 * Kept to four decimals (a 10.00 line for 3 is 3.3333, not 3.33) so scaling
 * it back up by the same quantity round-trips to the cent. A missing or
 * non-positive quantity can't divide, so the price is taken as-is. */
export function unitPriceOf(linePrice: number, quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return linePrice;
  return Math.round((linePrice / quantity) * 10_000) / 10_000;
}

/** A new row's default estimate from the item's last known unit price:
 * `unitPrice` × the row's quantity, to the cent. `null`/`undefined` pass
 * through as `undefined` (no estimate), which is what Prisma's create wants
 * for "leave the column null". */
export function defaultLineEstimate(unitPrice: number | null | undefined, quantity: number): number | undefined {
  if (unitPrice == null) return undefined;
  if (!Number.isFinite(quantity) || quantity <= 0) return unitPrice;
  return round2(unitPrice * quantity);
}
