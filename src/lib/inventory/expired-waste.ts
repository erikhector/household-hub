// GAP-17 — "food that expired unused", derived from what InventoryItem
// already stores, with no migration and no per-write hook. Pure so it's
// unit-testable without Prisma; the Cost analyzer's Server Component
// (src/app/dashboard/budget/page.tsx) fetches the candidate rows and only
// calls this.
//
// What the data can honestly support. There's no stock-movement log, so
// when an item's quantity is zeroed the amount that was thrown out is gone,
// and a restock rewrites an *estimated* `expiresAt` (AUTO-7's
// estimatedExpiryUpdate), so the signal also decays over time. What's left
// is a snapshot, and this reads it the following way. An item counts as
// "went past its date unused" in a month when its `expiresAt` falls inside
// that month, the date has already passed, and either:
//
//   - it still has stock (`quantity > 0`) — nobody used it up in time; or
//   - it's empty and was last written *on or after* its date
//     (`updatedAt >= expiresAt`) — emptied after it expired, which is the
//     "mark empty / edit to 0 while expired" case BACKLOG's GAP-17 names as
//     waste. An empty item last written *before* its date was used up in
//     time and is never counted.
//
// The second rule is an inference, not a record: `updatedAt` moves on any
// write, so an item emptied before its date and then renamed afterwards
// would be miscounted. That's rare enough (and the figure is labelled "≈")
// that the alternative — dropping emptied items entirely, so throwing
// something out makes its waste *disappear* from the recap — is the worse
// kind of wrong.
//
// Valuation: one `lastKnownPrice` per item, never `lastKnownPrice ×
// quantity`. `lastKnownPrice` is the price of one shopping-list *line*
// (AUTO-4's "a 2-pack priced at 24 books as 24" convention), not a price
// per inventory unit, so multiplying it by a quantity measured in, say,
// grams would produce nonsense. "Roughly what you paid last time you bought
// it" is the honest unit. Items with no known price are counted
// (`unpricedCount`) but add nothing to the money figure.
//
// Estimated dates (`expiresAtEstimated`) are a category-default guess —
// "dairy lasts 7 days" — and plenty of estimated-expired food is still
// perfectly fine and gets eaten. So they're kept out of the headline figure
// (`confirmedValue`, real user-entered dates only) and summed separately
// (`estimatedValue`), which the UI shows as a softer "maybe" line rather
// than folding a guess into a number that reads as money lost.

export type ExpiredWasteCandidate = {
  id: string;
  name: string;
  quantity: number;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
  lastKnownPrice: number | null;
  updatedAt: Date;
};

export type ExpiredWasteItem = {
  id: string;
  name: string;
  expiresAt: Date;
  estimated: boolean;
  value: number | null;
};

export type ExpiredWasteSummary = {
  items: ExpiredWasteItem[];
  /** Sum of `lastKnownPrice` for items with a real (user-entered) date. */
  confirmedValue: number;
  /** Same, for items whose date is AUTO-7's estimate. */
  estimatedValue: number;
  /** Items counted with no known price — in `items`, not in either sum. */
  unpricedCount: number;
};

export function isExpiredUnused(
  item: ExpiredWasteCandidate,
  monthStart: Date,
  monthEnd: Date,
  now: Date,
): boolean {
  const { expiresAt } = item;
  if (!expiresAt) return false;
  const t = expiresAt.getTime();
  // Inside the month (end exclusive, the budget pages' convention) and
  // already past — a date later this month hasn't happened yet.
  if (t < monthStart.getTime() || t >= monthEnd.getTime() || t >= now.getTime()) return false;
  if (item.quantity > 0) return true;
  return item.updatedAt.getTime() >= t;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeExpiredWaste(
  candidates: ExpiredWasteCandidate[],
  monthStart: Date,
  monthEnd: Date,
  now: Date,
): ExpiredWasteSummary {
  let confirmedValue = 0;
  let estimatedValue = 0;
  let unpricedCount = 0;
  const items: ExpiredWasteItem[] = [];

  for (const candidate of candidates) {
    if (!isExpiredUnused(candidate, monthStart, monthEnd, now)) continue;
    const value = candidate.lastKnownPrice != null && candidate.lastKnownPrice > 0 ? candidate.lastKnownPrice : null;
    if (value == null) unpricedCount++;
    else if (candidate.expiresAtEstimated) estimatedValue += value;
    else confirmedValue += value;
    items.push({
      id: candidate.id,
      name: candidate.name,
      expiresAt: candidate.expiresAt!,
      estimated: candidate.expiresAtEstimated,
      value,
    });
  }

  // Real dates first (they're what the headline figure is made of), then
  // the most expensive, then name for a stable order.
  items.sort(
    (a, b) =>
      Number(a.estimated) - Number(b.estimated) ||
      (b.value ?? -1) - (a.value ?? -1) ||
      a.name.localeCompare(b.name),
  );

  return {
    items,
    confirmedValue: roundMoney(confirmedValue),
    estimatedValue: roundMoney(estimatedValue),
    unpricedCount,
  };
}
