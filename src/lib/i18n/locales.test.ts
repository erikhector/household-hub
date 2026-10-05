import { describe, expect, it } from "vitest";
import { negotiateLocale } from "@/lib/i18n/locales";

describe("negotiateLocale", () => {
  it("falls back to English with no header", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
  });

  it("matches on the primary subtag", () => {
    expect(negotiateLocale("sv-SE")).toBe("sv");
    expect(negotiateLocale("SV")).toBe("sv");
  });

  it("honours q-values and header order", () => {
    expect(negotiateLocale("en;q=0.5, sv;q=0.9")).toBe("sv");
    expect(negotiateLocale("de, sv;q=0.8, en;q=0.7")).toBe("sv");
    expect(negotiateLocale("en, sv")).toBe("en");
  });

  it("ignores unsupported languages and q=0", () => {
    expect(negotiateLocale("de-DE, fr;q=0.8")).toBe("en");
    expect(negotiateLocale("sv;q=0, en")).toBe("en");
  });
});
