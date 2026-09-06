// Server-only: fetches a live currency-conversion rate from Frankfurter
// (https://frankfurter.dev), a free ECB-rates API that needs no API key or
// signup. Used by applyReceiptScanAction (shopping-list/actions.ts) to
// convert a scanned receipt's currency to HOUSEHOLD_BASE_CURRENCY
// (src/lib/currency.ts) before recording it.

/**
 * The multiplier to convert 1 unit of `from` into `to`, or null if the rate
 * couldn't be fetched (offline, API down, unrecognized currency code) —
 * callers must treat null as "conversion unavailable", never assume 1:1.
 */
export async function fetchExchangeRate(from: string, to: string): Promise<number | null> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;

  try {
    const url = `https://api.frankfurter.dev/v1/latest?amount=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    // Rates move slowly (daily ECB reference rates) — an hour of caching
    // avoids hitting the API on every scanned line item.
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[to.toUpperCase()];
    return typeof rate === "number" ? rate : null;
  } catch {
    return null;
  }
}
