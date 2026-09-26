// Pure aggregation logic for Cost analyzer's "cheapest store" insight
// (GAP-6) — see REQUIREMENTS.md's "Cost analyzer" subsection under
// Budgeting. Kept dependency-free (no Prisma import) so it's unit-testable
// with plain fixtures; src/app/dashboard/budget/page.tsx is the only
// caller, feeding it the same `priceHistoryRows` query it already runs for
// the rest of the analyzer.
//
// `PriceHistory.store` has existed in the schema since AUTO-9's groundwork,
// but nothing ever wrote it until GAP-6 threaded an optional store name
// through receipt scan/register (src/app/dashboard/shopping-list/actions.ts). So most rows still have a
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

type LastStorePrice = { store: string; price: number; date: Date };

// Shared by both calculators in this module: each item's *last recorded*
// price at every distinct store, keyed by the case/whitespace-folded store
// name. Factored out of computeCheapestStoreComparisons (GAP-34) so the
// basket comparison can never drift from the per-item one on what "that
// store's price" means.
function lastPricePerItemStore(rows: PriceHistoryStoreRow[]) {
  const lastByItemStore = new Map<string, Map<string, LastStorePrice>>();
  const namesById = new Map<string, string>();

  for (const row of rows) {
    const store = row.store?.trim();
    if (!store) continue;
    namesById.set(row.inventoryItemId, row.itemName);
    const perStore = lastByItemStore.get(row.inventoryItemId) ?? new Map<string, LastStorePrice>();
    const storeKey = store.toLocaleLowerCase();
    const existing = perStore.get(storeKey);
    if (!existing || row.date >= existing.date) {
      perStore.set(storeKey, { store, price: row.price, date: row.date });
    }
    lastByItemStore.set(row.inventoryItemId, perStore);
  }

  return { lastByItemStore, namesById };
}

/**
 * For each item, finds the *last recorded* price at every distinct store
 * it's been bought at (not the lowest price ever seen — "last time" is the
 * ICA-app-style comparison this is modeled on: what would I pay *today* at
 * each store, going by the most recent data point), then picks the
 * cheapest of those. Items with fewer than two distinct non-null stores on
 * record are left out entirely — there's nothing to compare yet.
 *
 * Store names are free text typed per receipt/correction, so they're grouped
 * case- and whitespace-insensitively — "ICA" one week and "ica " the next
 * is one store, not a two-store comparison against itself. The name shown
 * is whichever spelling that store's most recent row used.
 *
 * Rows are expected in no particular order; this sorts each store's
 * candidates by date itself rather than relying on the caller's query
 * order, so it's safe to feed it the same `orderBy: { date: "asc" }` rows
 * page.tsx already fetches for the trend charts above (or, in a test, an
 * unordered fixture).
 */
export function computeCheapestStoreComparisons(rows: PriceHistoryStoreRow[]): StoreComparison[] {
  const { lastByItemStore, namesById } = lastPricePerItemStore(rows);

  const comparisons: StoreComparison[] = [];
  for (const [itemId, perStore] of lastByItemStore) {
    if (perStore.size < 2) continue;

    let cheapestStore = "";
    let cheapestPrice = Infinity;
    for (const { store, price } of perStore.values()) {
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

export type BasketStoreTotal = {
  store: string;
  // Sum of this store's last recorded price for the `pricedCount` basket
  // items it has one for — *only* those items. When pricedCount is below
  // BasketComparison.itemCount this is a partial total and the UI must say
  // so ("N of M items priced"); it is never a whole-basket figure.
  total: number;
  pricedCount: number;
};

export type BasketComparison = {
  // How many pending list items qualified (priced at ≥2 distinct stores) —
  // the "M" in every store's "N of M items priced".
  itemCount: number;
  // Ranked most items priced first, then cheapest — see
  // computeBasketStoreComparison's doc comment for why coverage comes first.
  stores: BasketStoreTotal[];
};

// Fewer qualifying items than this and there's no "basket" to speak of —
// a single item is already covered, better, by the per-item "Cheapest
// store" list right above it.
export const MIN_BASKET_ITEMS = 2;

/**
 * GAP-34: the whole-basket counterpart to computeCheapestStoreComparisons —
 * what would the household's *current* shopping (the pending, i.e.
 * unchecked, items on its ACTIVE lists) cost at each store, going by each
 * item's last recorded price there. Returns null when fewer than
 * MIN_BASKET_ITEMS items qualify, so the caller shows an empty state
 * instead of a one-item "basket".
 *
 * Which items count: only those priced at ≥2 distinct stores — the same
 * bar GAP-6 sets per item. An item priced at just one store can't tell two
 * stores apart, it would only add one more gap to every other store's
 * coverage. `pendingItemIds` is de-duplicated, so an item that's on two
 * active lists is in the basket once (you'd buy it once). List rows with no
 * linked inventory item never get here — they have no price history.
 *
 * Coverage — the honest-comparison problem: not every store has a price
 * for every item. Two options were weighed:
 *
 *  - rank stores on only the items they *all* have in common. Exact when
 *    it works, but the intersection shrinks with every store added: one
 *    rarely visited store with a single recorded price would collapse the
 *    whole comparison to that one item (or to nothing), hiding everything
 *    the household does know about the stores it actually uses.
 *  - (chosen) give every store its own total over the items it *does*
 *    have a price for, and always report that coverage alongside it as
 *    "N of M items priced". Nothing known is thrown away, and a total is
 *    never shown as more complete than it is.
 *
 * Ranking then orders by coverage first (most items priced wins) and only
 * lets totals decide between stores with the *same* coverage. That's what
 * stops a partial total from outranking a complete one merely because it's
 * missing items — a store that only looks cheaper because it has no price
 * for the expensive coffee can't come out on top. Equal coverage and total
 * fall back to store name, for a stable order.
 *
 * Prices are summed as recorded: PriceHistory.price is the whole purchased
 * line's price, not per unit, and this deliberately doesn't rescale it to
 * the list row's quantity — units differ between receipts and list rows
 * often enough that rescaling would invent precision the data doesn't
 * have. It answers "what did these items cost last time at each store",
 * the same framing GAP-6 uses per item.
 */
export function computeBasketStoreComparison(
  rows: PriceHistoryStoreRow[],
  pendingItemIds: Iterable<string>,
): BasketComparison | null {
  const pending = new Set(pendingItemIds);
  const { lastByItemStore } = lastPricePerItemStore(
    rows.filter((row) => pending.has(row.inventoryItemId)),
  );

  const qualifying = [...lastByItemStore.values()].filter((perStore) => perStore.size >= 2);
  if (qualifying.length < MIN_BASKET_ITEMS) return null;

  // Keyed by the folded store name, same as per item; the spelling shown is
  // the most recent one that store was recorded under across the basket.
  const byStore = new Map<string, BasketStoreTotal & { date: Date }>();
  for (const perStore of qualifying) {
    for (const [storeKey, { store, price, date }] of perStore) {
      const existing = byStore.get(storeKey);
      if (!existing) {
        byStore.set(storeKey, { store, total: price, pricedCount: 1, date });
        continue;
      }
      existing.total += price;
      existing.pricedCount += 1;
      if (date >= existing.date) {
        existing.store = store;
        existing.date = date;
      }
    }
  }

  const stores = [...byStore.values()]
    .map(({ store, total, pricedCount }) => ({ store, total, pricedCount }))
    .sort(
      (a, b) =>
        b.pricedCount - a.pricedCount || a.total - b.total || a.store.localeCompare(b.store),
    );

  return { itemCount: qualifying.length, stores };
}
