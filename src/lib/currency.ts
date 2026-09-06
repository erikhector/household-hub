// The currency every amount in this app is assumed to already be recorded
// in. Nothing else in the schema (Transaction/RecurringTemplate/
// ShoppingListItem, etc.) has a currency column — every amount is a plain
// Float — so rather than build a whole per-household currency setting,
// receipt scanning (the one place a foreign currency can enter the app,
// via ReceiptScanDialog) just converts to this fixed constant. Change it
// here if that assumption ever needs to differ.
export const HOUSEHOLD_BASE_CURRENCY = "SEK";

// Currencies the receipt scanner's currency picker offers and
// detectReceiptCurrency (receipt-parsing.ts) can recognize from receipt
// text. Not an enum/schema concept — just what the UI/parser know about.
export const SUPPORTED_CURRENCIES = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK", "CHF"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
