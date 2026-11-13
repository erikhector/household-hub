import { describe, expect, it } from "vitest";
import { datedName, format, formatDecimal, plural } from "@/lib/i18n/format";

describe("plural", () => {
  it("returns the singular form for a count of exactly 1", () => {
    expect(plural(1, { one: "1 item", other: "{count} items" })).toBe("1 item");
  });

  it("returns the plural form for 0", () => {
    expect(plural(0, { one: "1 item", other: "{count} items" })).toBe("{count} items");
  });

  it("returns the plural form for counts greater than 1", () => {
    expect(plural(2, { one: "1 item", other: "{count} items" })).toBe("{count} items");
  });

  it("returns the plural form for negative counts", () => {
    expect(plural(-1, { one: "1 item", other: "{count} items" })).toBe("{count} items");
  });
});

describe("format", () => {
  it("interpolates a single variable", () => {
    expect(format("Hello {name}", { name: "Erik" })).toBe("Hello Erik");
  });

  it("interpolates multiple variables", () => {
    expect(format("{name} has {count} items", { name: "Erik", count: 3 })).toBe(
      "Erik has 3 items",
    );
  });

  it("interpolates the same key used more than once", () => {
    expect(format("{name} and {name} again", { name: "Erik" })).toBe("Erik and Erik again");
  });

  it("coerces numeric values to strings", () => {
    expect(format("{count}", { count: 0 })).toBe("0");
  });

  it("leaves an unmatched placeholder untouched", () => {
    expect(format("Hello {name}", {})).toBe("Hello {name}");
  });

  it("returns the template unchanged when it has no placeholders", () => {
    expect(format("No placeholders here", { unused: "value" })).toBe("No placeholders here");
  });
});

describe("datedName", () => {
  // A local date, formatted in that same local zone, so the day can't shift.
  const date = new Date(2026, 9, 5, 12);

  it("writes the date in Swedish for sv", () => {
    expect(datedName("Inköpslista", "sv", date)).toBe("Inköpslista — 5 okt. 2026");
  });

  it("writes the date in English for en", () => {
    expect(datedName("Shopping list", "en", date)).toBe("Shopping list — Oct 5, 2026");
  });
});

describe("formatDecimal", () => {
  it("uses the locale's decimal mark (UX-187)", () => {
    expect(formatDecimal(0.5, "sv")).toBe("0,5");
    expect(formatDecimal(0.5, "en")).toBe("0.5");
  });

  it("keeps three significant digits by default and drops trailing zeros", () => {
    expect(formatDecimal(0.375, "sv")).toBe("0,375");
    expect(formatDecimal(0.0091234, "en")).toBe("0.00912");
    expect(formatDecimal(2, "en")).toBe("2");
  });

  it("keeps more digits when asked, for a value the user typed", () => {
    expect(formatDecimal(236.588, "en", 10)).toBe("236.588");
  });

  it("never groups thousands, so the value can pre-fill an input", () => {
    expect(formatDecimal(1240, "en")).toBe("1240");
    expect(formatDecimal(2000, "sv")).toBe("2000");
  });
});
