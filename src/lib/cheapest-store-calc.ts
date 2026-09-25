// Pure aggregation logic for Cost analyzer's "cheapest store" insight
// (GAP-6) — see REQUIREMENTS.md's "Cost analyzer" subsection under
// Budgeting. Kept dependency-free (no Prisma import) so it's unit-testable
// with plain fixtures; src/app/dashboard/budget/page.tsx is the only
// caller, feeding it the same `priceHistoryRows` query it already runs for
// the rest of the analyzer.
//
// `PriceHistory.store` has existed in the schema since AUTO-9's groundwork,
// but nothing ever wrote it until GAP-6 threaded an optional store name
// through receipt scan/register and the manual price-correct flow
// (src/app/dashboard/shopping-list/actions.ts). So most rows still have a
// null `store` — this only ever surfaces an item once *it* has at least two
// rows with a *distinct, non-null* store, the same "enough data to mean
// something" bar MIN_PRICE_POINTS_FOR_TREND sets for the trend cards above.

export type PriceHistoryStoreRow = {
  inventoryItemId: string;
  itemName: string;
  price: number;
  store: string | null;
  date: Date;
};

export type StoreComparison = {
  id: string;
  name: string;
  cheapestStore: string;
  cheapestPrice: number;
  // How many distinct stores this item has been priced at — shown as "vs N
  // other store(s)" so the household knows there's more behind the headline
  // number, without listing every store's price (see cost-analyzer.tsx's
  // doc comment for why this stays a one-line-per-item list rather than a
  // full per-store breakdown).
  storeCount: number;
};

/**
 * For each item, finds the *last recorded* price at every distinct store
 * it's been bought at (not the lowest price ever seen — "last time" is the
 * ICA-app-style comparison this is modeled on: what would I pay *today* at
 * each store, going by the most recent data point), then picks the
 * cheapest of those. Items with fewer than two distinct non-null stores on
 * record are left out entirely — there's nothing to compare yet.
 *
 * Rows are expected in no particular order; this sorts each store's
 * candidates by date itself rather than relying on the caller's query
 * order, so it's safe to feed it the same `orderBy: { date: "asc" }` rows
 * page.tsx already fetches for the trend charts above (or, in a test, an
 * unordered fixture).
 */
export function computeCheapestStoreComparisons(rows: PriceHistoryStoreRow[]): StoreComparison[] {
  const lastByItemStore = new Map<string, Map<string, { price: number; date: Date }>>();
  const namesById = new Map<string, string>();

  for (const row of rows) {
    if (!row.store) continue;
    namesById.set(row.inventoryItemId, row.itemName);
    const perStore = lastByItemStore.get(row.inventoryItemId) ?? new Map();
    const existing = perStore.get(row.store);
    if (!existing || row.date >= existing.date) {
      perStore.set(row.store, { price: row.price, date: row.date });
    }
    lastByItemStore.set(row.inventoryItemId, perStore);
  }

  const comparisons: StoreComparison[] = [];
  for (const [itemId, perStore] of lastByItemStore) {
    if (perStore.size < 2) continue;

    let cheapestStore = "";
    let cheapestPrice = Infinity;
    for (const [store, { price }] of perStore) {
      if (price < cheapestPrice) {
        cheapestPrice = price;
        cheapestStore = store;
      }
    }

    comparisons.push({
      id: itemId,
      name: namesById.get(itemId) ?? "",
      cheapestStore,
      cheapestPrice,
      storeCount: perStore.size,
    });
  }

  return comparisons.sort((a, b) => a.name.localeCompare(b.name));
}
