// GAP-33 — "what's on hand is worth roughly this", Grocy's headline pantry
// stat, derived from what InventoryItem already stores (no migration). Pure
// so it's unit-testable without Prisma; the Cost analyzer's Server Component
// (src/app/dashboard/budget/page.tsx) fetches the household's items and only
// calls this — the same split as GAP-17's computeExpiredWaste
// (./expired-waste.ts), whose valuation caveats this follows exactly.
//
// Which items count: only ones the household actually has, `quantity > 0`.
// An item row with nothing left is a "we usually keep this" placeholder
// (it's what the restock/low-stock flows key off), not stock, so it adds
// neither value nor to either count. The page's query already filters these
// out; the check is repeated here so the calculator is honest on its own.
// Items past their date but still on the shelf *are* counted — they're
// still physically there, and whether they went to waste is GAP-17's
// question, not this one's.
//
// Valuation: one `lastKnownPrice` per item, never `lastKnownPrice ×
// quantity`. `lastKnownPrice` is the price of one shopping-list *line*
// (AUTO-4's "a 2-pack priced at 24 books as 24" convention), not a price
// per inventory unit, so multiplying it by 500 (grams) or 6 (eggs, bought as
// one carton) would be nonsense. "Roughly what you paid last time you
// bought it", once per item, is the honest unit — which also means a half-
// used bag counts at its full price, so the figure is an upper-ish estimate
// and the UI shows it with "≈".
//
// Items in stock with no known price (never bought via a priced shopping
// line, or priced at 0) add nothing to the sum but are still counted, so
// the UI can say "based on N of M items with a known price" rather than
// passing off a partial sum as the whole pantry.

export type StockValueCandidate = {
  quantity: number;
  lastKnownPrice: number | null;
};

export type StockValueSummary = {
  /** Sum of `lastKnownPrice` over priced in-stock items, rounded to cents. */
  value: number;
  /** In-stock items with a known (> 0) price — the ones `value` is made of. */
  pricedCount: number;
  /** In-stock items with no known price — counted, not valued. */
  unpricedCount: number;
  /** Every in-stock item: `pricedCount + unpricedCount`. */
  inStockCount: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeStockValue(items: StockValueCandidate[]): StockValueSummary {
  let value = 0;
  let pricedCount = 0;
  let unpricedCount = 0;

  for (const item of items) {
    if (!(item.quantity > 0)) continue;
    if (item.lastKnownPrice != null && item.lastKnownPrice > 0) {
      value += item.lastKnownPrice;
      pricedCount++;
    } else {
      unpricedCount++;
    }
  }

  return {
    value: roundMoney(value),
    pricedCount,
    unpricedCount,
    inStockCount: pricedCount + unpricedCount,
  };
}
