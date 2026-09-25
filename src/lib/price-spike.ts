// GAP-9: the pure decision behind PRICE_SPIKE notifications — "is the price
// just recorded for this item materially above what the household usually
// pays for it?" Kept dependency-free apart from the unit table (no Prisma
// import) so every threshold below is unit-testable with plain fixtures;
// recordPriceSpikes in src/lib/notifications.ts is the only caller, and owns
// the queries, the per-item dedupe/cooldown and the push.
//
// This is a bell alert, not an in-list suggestion, so it has to be right far
// more often than it's noisy — every rule below exists to rule out a
// specific false alarm:
//
// - **Per unit, like-for-like.** A PriceHistory row's `price` is what the
//   whole purchased line cost (a shopping-list item's estimatedPrice, a
//   receipt line), not one unit of it, so buying two packs instead of one
//   doubles it without the price having moved at all. Every price is divided
//   by its line's quantity first, and prior lines are only compared if their
//   unit is the same as the new line's (case/whitespace-insensitive) or
//   convertible into it via src/lib/units.ts (500 g vs 1 kg). Rows with no
//   quantity/unit — everything recorded before GAP-9 added those columns —
//   can't be put on a per-unit footing and are ignored, which means an item
//   only becomes eligible once it has PRICE_SPIKE_MIN_PRIOR_PRICES
//   comparable purchases recorded since then.
// - **Enough history to have a "usual".** Fewer than
//   PRICE_SPIKE_MIN_PRIOR_PRICES comparable prior prices is no alert: with
//   one or two data points a sale price looks like the norm and the next
//   regular price looks like a spike.
// - **Median of a trailing window.** The baseline is the median of the most
//   recent PRICE_SPIKE_TRAILING_WINDOW comparable prices within
//   PRICE_SPIKE_MAX_AGE_DAYS — the median so one past sale (or one past
//   spike) doesn't drag it, the window/age cap so a price that's genuinely
//   risen and stayed up becomes the new normal instead of alerting forever,
//   and years-old prices don't turn ordinary inflation into an alert.
// - **Relative AND absolute.** The new unit price must be at least
//   PRICE_SPIKE_MIN_RATIO × the median, *and* the extra cost on this line
//   ((unit price − median) × quantity) must be at least
//   PRICE_SPIKE_MIN_EXTRA_COST in the household's base currency. The ratio
//   alone would fire on a 10 kr item going to 13 kr; the absolute floor alone
//   would fire on ordinary variance of an expensive item. Measuring the
//   absolute part in money-on-this-receipt rather than per unit keeps it
//   meaningful whatever the unit is (a per-gram delta is always tiny).
//
// Several lines for the same item in one batch (the same product twice on a
// receipt, a discount line) are pooled into one purchase — total price over
// total quantity — so they produce one decision, not one per line, and a
// discount line pulls the effective price down the way it did at the till.

import { convertQuantity } from "@/lib/units";

export const PRICE_SPIKE_MIN_PRIOR_PRICES = 3;
export const PRICE_SPIKE_TRAILING_WINDOW = 10;
export const PRICE_SPIKE_MAX_AGE_DAYS = 365;
// 25% above the usual price — well outside week-to-week shelf-price
// variance, well inside what a household would call "wait, what?".
export const PRICE_SPIKE_MIN_RATIO = 1.25;
// In HOUSEHOLD_BASE_CURRENCY (SEK, src/lib/currency.ts) — every PriceHistory
// row is already converted to it before it's written.
export const PRICE_SPIKE_MIN_EXTRA_COST = 10;
// How long after one PRICE_SPIKE alert (dismissed or not) the same item
// can't raise another — enforced by recordPriceSpikes, exported from here so
// the rules live in one place. Covers re-checking the same purchase
// (un-check/re-check writes a second PriceHistory row at the same price) and
// the next few purchases at the same new price while the median catches up.
export const PRICE_SPIKE_COOLDOWN_DAYS = 14;

export type PricePoint = {
  // What the whole line cost, in the base currency.
  price: number;
  quantity: number | null;
  unit: string | null;
  date: Date;
};

export type PriceSpike = {
  unitPrice: number;
  medianUnitPrice: number;
  // Rounded; what the bell and push copy show ("cost 40% more than usual").
  increasePercent: number;
  extraCost: number;
};

type ValidPoint = { price: number; quantity: number; unit: string; date: Date };

function isValid(point: PricePoint): point is ValidPoint {
  return (
    Number.isFinite(point.price) &&
    point.price > 0 &&
    point.quantity != null &&
    Number.isFinite(point.quantity) &&
    point.quantity > 0 &&
    typeof point.unit === "string" &&
    point.unit.trim() !== ""
  );
}

// `quantity` expressed in `targetUnit`, or null when the two units can't be
// compared. Same-string units are compared directly (so "pcs"/"pack"/any
// unit src/lib/units.ts doesn't know still matches itself).
function quantityIn(point: ValidPoint, targetUnit: string): number | null {
  if (point.unit.trim().toLowerCase() === targetUnit.trim().toLowerCase()) return point.quantity;
  return convertQuantity(point.quantity, point.unit, targetUnit);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * `recorded` is every price just written for one item in one action (one
 * line for a checkbox, possibly several for a receipt); `prior` is that
 * item's earlier PriceHistory rows, in any order, *excluding* the ones in
 * `recorded`. Returns the spike, or null when there isn't one or there
 * isn't enough comparable data to say.
 */
export function detectPriceSpike(prior: PricePoint[], recorded: PricePoint[], now: Date): PriceSpike | null {
  const recordedValid = recorded.filter(isValid);
  if (recordedValid.length === 0) return null;

  // The first line's unit is the yardstick; other lines in the same batch
  // are pooled into it when convertible and otherwise left out.
  const unit = recordedValid[0].unit;
  let totalPrice = 0;
  let totalQuantity = 0;
  for (const point of recordedValid) {
    const quantity = quantityIn(point, unit);
    if (quantity == null) continue;
    totalPrice += point.price;
    totalQuantity += quantity;
  }
  const unitPrice = totalPrice / totalQuantity;

  const oldest = now.getTime() - PRICE_SPIKE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const priorUnitPrices = prior
    .filter(isValid)
    .filter((point) => point.date.getTime() >= oldest)
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .flatMap((point) => {
      const quantity = quantityIn(point, unit);
      return quantity == null || quantity <= 0 ? [] : [point.price / quantity];
    })
    .slice(0, PRICE_SPIKE_TRAILING_WINDOW);
  if (priorUnitPrices.length < PRICE_SPIKE_MIN_PRIOR_PRICES) return null;

  const medianUnitPrice = median(priorUnitPrices);
  if (!(medianUnitPrice > 0)) return null;

  const ratio = unitPrice / medianUnitPrice;
  if (ratio < PRICE_SPIKE_MIN_RATIO) return null;

  const extraCost = (unitPrice - medianUnitPrice) * totalQuantity;
  if (extraCost < PRICE_SPIKE_MIN_EXTRA_COST) return null;

  return {
    unitPrice,
    medianUnitPrice,
    increasePercent: Math.round((ratio - 1) * 100),
    extraCost,
  };
}
