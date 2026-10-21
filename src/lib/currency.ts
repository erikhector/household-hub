// The currency receipt scanning converts into. Nothing in the schema
// (Transaction/RecurringTemplate/ShoppingListItem, etc.) has a currency
// column — every amount is a plain Float — so receipt scanning (the one
// place a foreign currency can enter the app, via ReceiptScanDialog) just
// converts to this fixed constant, and GAP-9's price-spike thresholds are
// written in it. Household.currencyCode (GAP-13, below) is only a display
// label and deliberately doesn't change this: switching it would silently
// change what every future receipt converts to without touching the
// amounts already stored.
export const HOUSEHOLD_BASE_CURRENCY = "SEK";

// Currencies the receipt scanner's currency picker offers and
// detectReceiptCurrency (receipt-parsing.ts) can recognize from receipt
// text. Not an enum/schema concept — just what the UI/parser know about.
export const SUPPORTED_CURRENCIES = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK", "CHF"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

// --- Household display currency (GAP-13) ---------------------------------
//
// Household.currencyCode is a *label*, not a unit conversion: every amount
// stays the plain Float it was saved as, and changing the setting never
// rewrites or converts anything. The allow-list is SUPPORTED_CURRENCIES so
// the Household page's picker and the receipt scanner's picker offer the
// same set, all of which have two minor-unit digits — which matters because
// every amount in the app is entered and stored to two decimals.

/**
 * Normalizes a submitted household currency: a supported ISO 4217 code
 * (case-insensitive, surrounding spaces ignored) → the upper-case code; an
 * empty string, null or undefined → null ("no currency", the symbol-free
 * default); anything else → undefined, which callers treat as invalid input.
 */
export function parseHouseholdCurrency(value: unknown): SupportedCurrency | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "") return null;
  return isSupportedCurrency(normalized) ? normalized : undefined;
}

/**
 * The one on-screen money formatter. With a currency set it's
 * `{ style: "currency" }`, so the locale decides the symbol and where it
 * goes ("12,50 kr" in sv, "SEK 12.50" in en); without one it's the plain
 * two-decimal, symbol-free number every amount used before GAP-13. Returns
 * the Intl.NumberFormat itself rather than a string so components that
 * already hand a `numberFormat` down to their rows keep doing so.
 *
 * An unrecognized stored code (only reachable by editing the database by
 * hand, since setHouseholdCurrencyAction allow-lists it) falls back to the
 * plain format instead of letting Intl throw a RangeError mid-render.
 *
 * CSV exports deliberately don't use this — see src/lib/csv.ts.
 */
export function createMoneyFormat(locale: string | undefined, currencyCode?: string | null): Intl.NumberFormat {
  const decimals = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
  if (isSupportedCurrency(currencyCode)) {
    return new Intl.NumberFormat(locale, { ...decimals, style: "currency", currency: currencyCode });
  }
  return new Intl.NumberFormat(locale, decimals);
}

// --- Default currency for a new household (UX-73) -------------------------
//
// A new household used to start with currencyCode null, so every amount was
// a bare number until someone found the setting on the Household page. The
// signup and "create household" actions now derive a starting label (M4,
// default what you can derive) from what they already know. Still only a
// label: nothing is converted, and the owner can change it in one tap.

// Region (the part after the dash in an `Accept-Language` tag, "en-GB" ->
// "GB") to a SUPPORTED_CURRENCIES entry. Only regions whose currency the
// app can label are listed: a Canadian or Australian browser gets no
// default rather than a wrong one, because "$" would read as US dollars.
const REGION_CURRENCY: Record<string, SupportedCurrency> = {
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  CH: "CHF",
  LI: "CHF",
  GB: "GBP",
  US: "USD",
  // The euro area.
  AT: "EUR",
  BE: "EUR",
  HR: "EUR",
  CY: "EUR",
  EE: "EUR",
  FI: "EUR",
  FR: "EUR",
  DE: "EUR",
  GR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LV: "EUR",
  LT: "EUR",
  LU: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SK: "EUR",
  SI: "EUR",
  ES: "EUR",
};

/**
 * The currency a new household starts with. A Swedish-language signup gets
 * SEK (the app's home market, and what Swish and receipt conversion
 * already assume). Otherwise the region of the browser's highest-ranked
 * `Accept-Language` tag that names one decides ("en-GB" -> GBP, "en-US" ->
 * USD, "de-DE" -> EUR). Null when no region is known or its currency isn't
 * in SUPPORTED_CURRENCIES, which keeps the symbol-free default.
 */
export function defaultCurrencyForNewHousehold(
  locale: string,
  acceptLanguage: string | null | undefined,
): SupportedCurrency | null {
  if (locale === "sv") return "SEK";
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      const weight = q === undefined ? 1 : Number(q);
      const region = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})$/i.exec(tag.trim())?.[1]?.toUpperCase();
      return { region, weight, index };
    })
    .filter((entry) => entry.region && entry.weight > 0 && Number.isFinite(entry.weight))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const first = ranked[0]?.region;
  return first ? (REGION_CURRENCY[first] ?? null) : null;
}
