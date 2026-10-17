// AUTO-4 — pure summation for the shopping-list header's running estimate,
// dependency-free so it's unit-testable without a DOM the way
// shopping-mode-grouping.ts is; the client component
// (src/components/shopping/shopping-list-client.tsx) only calls this and
// renders the result.
//
// Per-unit, unmultiplied by quantity — the same convention
// completeShoppingListAction (src/app/dashboard/shopping-list/actions.ts)
// already uses when it sums estimatedPrice into the Groceries expense at
// list completion (see REQUIREMENTS.md's "Shopping-list → budget expense
// link"). Keeping the two summations identical means this header total
// reads as a preview of what's left to book, not a different number that
// happens to look similar.
//
// Deliberately only sums *pending* items, not every item on the list: a
// purchased item's price was already folded into InventoryItem.lastKnownPrice
// and (once the list completes) the Groceries expense, so counting it again
// here would double it into "what's left to spend" — this is meant to answer
// "how much more will this trip cost", not "how much has this list cost so
// far".
export function sumEstimatedPendingTotal(pendingItems: { estimatedPrice: number | null }[]): number {
  return pendingItems.reduce((sum, item) => sum + (item.estimatedPrice ?? 0), 0);
}

/**
 * UX-87: how much of a set of rows actually carries a price. The header
 * shows "≈ 24.90 still to buy (1 of 14 priced)" instead of a bare amount,
 * because a sum over one priced row of fourteen reads as the trip's cost
 * when it is a fraction of it. Counts a row as priced exactly when
 * sumEstimatedPendingTotal would add something for it (non-null price).
 */
export function countPriced(items: { estimatedPrice: number | null }[]): { priced: number; total: number } {
  return { priced: items.filter((item) => item.estimatedPrice != null).length, total: items.length };
}
