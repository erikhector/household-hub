import { describe, expect, it } from "vitest";
import { createMoneyFormat, defaultCurrencyForNewHousehold, isSupportedCurrency, parseHouseholdCurrency, SUPPORTED_CURRENCIES } from "./currency";

// Intl separates a currency symbol from the number with a (narrow) no-break
// space, and sv-SE groups thousands with one too. Normalized to a plain
// space so the expectations below stay readable.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("isSupportedCurrency", () => {
  it("accepts every allow-listed code", () => {
    for (const code of SUPPORTED_CURRENCIES) expect(isSupportedCurrency(code)).toBe(true);
  });

  it("rejects lower case, unknown codes and non-strings", () => {
    expect(isSupportedCurrency("sek")).toBe(false);
    expect(isSupportedCurrency("JPY")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
    expect(isSupportedCurrency(42)).toBe(false);
  });
});

describe("parseHouseholdCurrency", () => {
  it("normalizes case and whitespace", () => {
    expect(parseHouseholdCurrency("eur")).toBe("EUR");
    expect(parseHouseholdCurrency("  Sek ")).toBe("SEK");
  });

  it("treats empty, null and undefined as no currency", () => {
    expect(parseHouseholdCurrency("")).toBeNull();
    expect(parseHouseholdCurrency("   ")).toBeNull();
    expect(parseHouseholdCurrency(null)).toBeNull();
    expect(parseHouseholdCurrency(undefined)).toBeNull();
  });

  it("returns undefined for anything off the allow-list", () => {
    expect(parseHouseholdCurrency("JPY")).toBeUndefined();
    expect(parseHouseholdCurrency("kronor")).toBeUndefined();
    expect(parseHouseholdCurrency(12)).toBeUndefined();
    expect(parseHouseholdCurrency({})).toBeUndefined();
  });
});

describe("createMoneyFormat", () => {
  it("keeps the symbol-free two-decimal format when no currency is set", () => {
    expect(plain(createMoneyFormat("en", null).format(1234.5))).toBe("1,234.50");
    expect(plain(createMoneyFormat("sv", undefined).format(1234.5))).toBe("1 234,50");
    expect(plain(createMoneyFormat("en").format(3))).toBe("3.00");
  });

  it("adds the currency, placed by the locale, when one is set", () => {
    expect(plain(createMoneyFormat("sv", "SEK").format(1234.5))).toBe("1 234,50 kr");
    expect(plain(createMoneyFormat("en", "USD").format(1234.5))).toBe("$1,234.50");
    expect(plain(createMoneyFormat("en", "EUR").format(12))).toBe("€12.00");
    // Two decimals even though Intl's currency default would already
    // give that for these codes — pinned so a future allow-list entry
    // can't quietly change how amounts round.
    expect(plain(createMoneyFormat("en", "GBP").format(0.1))).toBe("£0.10");
  });

  it("falls back to the plain format for an unrecognized stored code", () => {
    expect(() => createMoneyFormat("en", "NOT-A-CODE")).not.toThrow();
    expect(plain(createMoneyFormat("en", "JPY").format(5))).toBe("5.00");
  });
});

describe("defaultCurrencyForNewHousehold (UX-73)", () => {
  it("gives a Swedish-language signup SEK whatever the browser region says", () => {
    expect(defaultCurrencyForNewHousehold("sv", null)).toBe("SEK");
    expect(defaultCurrencyForNewHousehold("sv", "en-US,en;q=0.9")).toBe("SEK");
  });

  it("derives an English signup's currency from the browser region", () => {
    expect(defaultCurrencyForNewHousehold("en", "en-GB,en;q=0.9")).toBe("GBP");
    expect(defaultCurrencyForNewHousehold("en", "en-US,en;q=0.9")).toBe("USD");
    expect(defaultCurrencyForNewHousehold("en", "de-DE,de;q=0.9,en;q=0.8")).toBe("EUR");
    expect(defaultCurrencyForNewHousehold("en", "en-SE")).toBe("SEK");
    expect(defaultCurrencyForNewHousehold("en", "nb-NO")).toBe("NOK");
    expect(defaultCurrencyForNewHousehold("en", "zh-Hant-CH")).toBe("CHF");
  });

  it("follows the q-ranking, not the header order", () => {
    expect(defaultCurrencyForNewHousehold("en", "en-US;q=0.5,en-GB;q=0.9")).toBe("GBP");
  });

  it("stays symbol-free when the region is unknown or has no supported currency", () => {
    expect(defaultCurrencyForNewHousehold("en", null)).toBeNull();
    expect(defaultCurrencyForNewHousehold("en", "")).toBeNull();
    expect(defaultCurrencyForNewHousehold("en", "en")).toBeNull();
    expect(defaultCurrencyForNewHousehold("en", "en-CA,en;q=0.9")).toBeNull();
    expect(defaultCurrencyForNewHousehold("en", "*")).toBeNull();
  });
});
