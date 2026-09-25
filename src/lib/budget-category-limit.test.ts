import { describe, expect, it } from "vitest";
import {
  limitForType,
  limitProgress,
  monthlyLimitField,
  rolloverEnabledField,
  rolloverForLimit,
  withCategoryLimits,
} from "@/lib/budget-category-limit";

describe("rolloverEnabledField", () => {
  it("reads a ticked native checkbox as on", () => {
    expect(rolloverEnabledField.parse("on")).toBe(true);
    expect(rolloverEnabledField.parse("true")).toBe(true);
  });

  it("reads a missing or anything-else value as off", () => {
    expect(rolloverEnabledField.parse(null)).toBe(false);
    expect(rolloverEnabledField.parse(undefined)).toBe(false);
    expect(rolloverEnabledField.parse("")).toBe(false);
    expect(rolloverEnabledField.parse("off")).toBe(false);
  });
});

describe("rolloverForLimit", () => {
  it("keeps rollover only when there's a limit to carry", () => {
    expect(rolloverForLimit(1000, true)).toBe(true);
    expect(rolloverForLimit(1000, false)).toBe(false);
    expect(rolloverForLimit(null, true)).toBe(false);
  });
});

describe("monthlyLimitField", () => {
  it("treats an empty, blank or missing field as 'no limit'", () => {
    expect(monthlyLimitField.parse("")).toBeNull();
    expect(monthlyLimitField.parse("   ")).toBeNull();
    expect(monthlyLimitField.parse(null)).toBeNull();
    expect(monthlyLimitField.parse(undefined)).toBeNull();
  });

  it("parses a positive amount", () => {
    expect(monthlyLimitField.parse("3000")).toBe(3000);
    expect(monthlyLimitField.parse(" 49.50 ")).toBe(49.5);
  });

  it("rejects zero and negative amounts", () => {
    expect(monthlyLimitField.safeParse("0").error?.issues[0]?.message).toBe(
      "Monthly limit must be greater than 0",
    );
    expect(monthlyLimitField.safeParse("-10").success).toBe(false);
  });

  it("rejects something that isn't a number", () => {
    expect(monthlyLimitField.safeParse("lots").error?.issues[0]?.message).toBe(
      "Monthly limit must be a number",
    );
  });
});

describe("limitForType", () => {
  it("keeps the limit only on expense categories", () => {
    expect(limitForType("EXPENSE", 500)).toBe(500);
    expect(limitForType("INCOME", 500)).toBeNull();
    expect(limitForType("SAVINGS", 500)).toBeNull();
    expect(limitForType("EXPENSE", null)).toBeNull();
  });
});

describe("limitProgress", () => {
  it("returns null when there is no usable limit", () => {
    expect(limitProgress(100, null)).toBeNull();
    expect(limitProgress(100, undefined)).toBeNull();
    expect(limitProgress(100, 0)).toBeNull();
    expect(limitProgress(100, -5)).toBeNull();
  });

  it("reports the share of the limit spent", () => {
    expect(limitProgress(250, 1000)).toEqual({ percent: 25, fillPercent: 25, over: false });
  });

  it("counts exactly the limit as on budget, not over", () => {
    expect(limitProgress(1000, 1000)).toEqual({ percent: 100, fillPercent: 100, over: false });
  });

  it("flags spending past the limit and clamps the bar fill", () => {
    expect(limitProgress(1500, 1000)).toEqual({ percent: 150, fillPercent: 100, over: true });
  });

  it("never draws a negative bar", () => {
    expect(limitProgress(-20, 100)).toEqual({ percent: 0, fillPercent: 0, over: false });
  });
});

describe("withCategoryLimits", () => {
  const categories = [
    { id: "food", name: "Food", monthlyLimit: 3000 },
    { id: "fun", name: "Fun", monthlyLimit: null },
    { id: "dining", name: "Dining out", monthlyLimit: 800 },
  ];

  it("attaches each category's limit to its total, null when uncapped", () => {
    const rows = withCategoryLimits(
      [
        { id: "food", name: "Food", total: 1200 },
        { id: "fun", name: "Fun", total: 300 },
      ],
      categories,
    );
    expect(rows.slice(0, 2)).toEqual([
      { id: "food", name: "Food", total: 1200, limit: 3000 },
      { id: "fun", name: "Fun", total: 300, limit: null },
    ]);
  });

  it("appends capped categories with no spending yet as zero rows", () => {
    const rows = withCategoryLimits([{ id: "food", name: "Food", total: 1200 }], categories);
    expect(rows).toContainEqual({ id: "dining", name: "Dining out", total: 0, limit: 800 });
    // Uncapped categories with no spending stay hidden, as before.
    expect(rows.find((r) => r.id === "fun")).toBeUndefined();
  });

  it("passes rows that aren't categories through with no limit", () => {
    const rows = withCategoryLimits([{ id: "shared:Rent", name: "Rent (Shared)", total: 5000 }], []);
    expect(rows).toEqual([{ id: "shared:Rent", name: "Rent (Shared)", total: 5000, limit: null }]);
  });
});
