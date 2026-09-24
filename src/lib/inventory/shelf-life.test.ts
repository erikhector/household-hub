import { describe, expect, it } from "vitest";
import {
  defaultShelfLifeDaysForCategory,
  estimateExpiryDate,
  estimatedExpiryUpdate,
  resolveShelfLifeDays,
  shouldEstimateExpiry,
} from "@/lib/inventory/shelf-life";

describe("defaultShelfLifeDaysForCategory", () => {
  it("recognizes an English category label", () => {
    expect(defaultShelfLifeDaysForCategory("Dairy & eggs")).toBe(7);
    expect(defaultShelfLifeDaysForCategory("Bakery")).toBe(4);
    expect(defaultShelfLifeDaysForCategory("Meat & fish")).toBe(3);
    expect(defaultShelfLifeDaysForCategory("Produce")).toBe(5);
  });

  it("recognizes the same category in Swedish", () => {
    expect(defaultShelfLifeDaysForCategory("Mejeri & ägg")).toBe(7);
    expect(defaultShelfLifeDaysForCategory("Bröd")).toBe(4);
    expect(defaultShelfLifeDaysForCategory("Kött & fisk")).toBe(3);
    expect(defaultShelfLifeDaysForCategory("Frukt & grönt")).toBe(5);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(defaultShelfLifeDaysForCategory("  dairy & EGGS  ")).toBe(7);
  });

  it("has no default for frozen/pantry/drinks/cleaning/bathroom", () => {
    for (const label of ["Frozen", "Pantry basics", "Drinks", "Cleaning supplies", "Bathroom essentials"]) {
      expect(defaultShelfLifeDaysForCategory(label)).toBeNull();
    }
  });

  it("returns null for a category that matches no known label", () => {
    expect(defaultShelfLifeDaysForCategory("Uncategorized")).toBeNull();
    expect(defaultShelfLifeDaysForCategory("My custom shelf")).toBeNull();
  });
});

describe("resolveShelfLifeDays", () => {
  it("prefers the item's own override over the category default", () => {
    expect(resolveShelfLifeDays(10, "Dairy & eggs")).toBe(10);
  });

  it("passes through -1 (never expires) even for a category with a default", () => {
    expect(resolveShelfLifeDays(-1, "Dairy & eggs")).toBe(-1);
  });

  it("falls back to the category default when unset", () => {
    expect(resolveShelfLifeDays(null, "Bakery")).toBe(4);
  });

  it("is null when neither an override nor a category default exists", () => {
    expect(resolveShelfLifeDays(null, "Pantry basics")).toBeNull();
  });
});

describe("estimateExpiryDate", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");

  it("adds the resolved shelf life in days", () => {
    expect(estimateExpiryDate(null, "Dairy & eggs", from)).toEqual(new Date("2026-01-08T00:00:00.000Z"));
  });

  it("is null for -1 (never expires)", () => {
    expect(estimateExpiryDate(-1, "Dairy & eggs", from)).toBeNull();
  });

  it("is null when nothing is known", () => {
    expect(estimateExpiryDate(null, "Pantry basics", from)).toBeNull();
  });
});

describe("shouldEstimateExpiry", () => {
  it("is true when stock crosses from 0 into positive", () => {
    expect(shouldEstimateExpiry({ expiresAt: null, expiresAtEstimated: false }, 0, 3)).toBe(true);
  });

  it("is true when the item has no expiry yet, even without a 0→>0 crossing", () => {
    expect(shouldEstimateExpiry({ expiresAt: null, expiresAtEstimated: false }, 2, 5)).toBe(true);
  });

  it("is true re-estimating over an existing estimate on a fresh 0→>0 crossing", () => {
    const existingEstimate = new Date("2026-01-05");
    expect(shouldEstimateExpiry({ expiresAt: existingEstimate, expiresAtEstimated: true }, 0, 2)).toBe(true);
  });

  it("never overwrites a real, user-entered date", () => {
    const realDate = new Date("2026-06-01");
    expect(shouldEstimateExpiry({ expiresAt: realDate, expiresAtEstimated: false }, 0, 3)).toBe(false);
    expect(shouldEstimateExpiry({ expiresAt: realDate, expiresAtEstimated: false }, 2, 5)).toBe(false);
  });

  it("leaves an already-estimated date alone outside a 0→>0 crossing", () => {
    const existingEstimate = new Date("2026-01-05");
    expect(shouldEstimateExpiry({ expiresAt: existingEstimate, expiresAtEstimated: true }, 2, 5)).toBe(false);
  });
});

describe("estimatedExpiryUpdate", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");

  it("returns the patch to write when an estimate should be set", () => {
    const patch = estimatedExpiryUpdate(
      { expiresAt: null, expiresAtEstimated: false, shelfLifeDays: null, category: "Dairy & eggs" },
      0,
      1,
      from,
    );
    expect(patch).toEqual({ expiresAt: new Date("2026-01-08T00:00:00.000Z"), expiresAtEstimated: true });
  });

  it("returns null when the category has no default and no override", () => {
    const patch = estimatedExpiryUpdate(
      { expiresAt: null, expiresAtEstimated: false, shelfLifeDays: null, category: "Pantry basics" },
      0,
      1,
      from,
    );
    expect(patch).toBeNull();
  });

  it("returns null for an item marked -1 (never expires), even on a 0→>0 crossing", () => {
    const patch = estimatedExpiryUpdate(
      { expiresAt: null, expiresAtEstimated: false, shelfLifeDays: -1, category: "Dairy & eggs" },
      0,
      1,
      from,
    );
    expect(patch).toBeNull();
  });

  it("returns null rather than overwrite a real date", () => {
    const patch = estimatedExpiryUpdate(
      {
        expiresAt: new Date("2026-06-01"),
        expiresAtEstimated: false,
        shelfLifeDays: null,
        category: "Dairy & eggs",
      },
      0,
      1,
      from,
    );
    expect(patch).toBeNull();
  });
});
