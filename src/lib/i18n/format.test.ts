import { describe, expect, it } from "vitest";
import { datedName, format, plural } from "@/lib/i18n/format";

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
