import { describe, expect, it } from "vitest";
import {
  categoriesNearLimit,
  categoryEnvelopes,
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
    expect(limitProgress(250, 1000)).toEqual({ percent: 25, fillPercent: 25, over: false, near: false });
  });

  it("counts exactly the limit as on budget, not over", () => {
    expect(limitProgress(1000, 1000)).toEqual({ percent: 100, fillPercent: 100, over: false, near: true });
  });

  it("flags spending past the limit and clamps the bar fill", () => {
    expect(limitProgress(1500, 1000)).toEqual({ percent: 150, fillPercent: 100, over: true, near: false });
  });

  it("flags the near state from 90% up to and including the limit (UX-115)", () => {
    expect(limitProgress(899, 1000)?.near).toBe(false);
    expect(limitProgress(900, 1000)?.near).toBe(true);
    expect(limitProgress(1000, 1000)?.near).toBe(true);
    expect(limitProgress(1001, 1000)?.near).toBe(false);
  });

  it("never draws a negative bar", () => {
    expect(limitProgress(-20, 100)).toEqual({ percent: 0, fillPercent: 0, over: false, near: false });
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

describe("categoriesNearLimit", () => {
  it("lists categories from 90% of their limit, over ones first", () => {
    const alerts = categoriesNearLimit([
      { id: "a", name: "Groceries", total: 450, limit: 500 },
      { id: "b", name: "Restaurants", total: 1355, limit: 800 },
      { id: "c", name: "Fun", total: 100, limit: 500 },
      { id: "d", name: "Fuel", total: 600, limit: 600 },
    ]);
    expect(alerts.map((a) => a.id)).toEqual(["b", "d", "a"]);
    expect(alerts[0]).toMatchObject({ spent: 1355, available: 800, over: true });
    expect(alerts[1].over).toBe(false);
  });

  it("skips just under 90%, uncapped rows and rows without a usable limit", () => {
    expect(
      categoriesNearLimit([
        { id: "a", name: "A", total: 89, limit: 100 },
        { id: "b", name: "B", total: 999, limit: null },
        { id: "c", name: "C", total: 50 },
        { id: "d", name: "D", total: 5, limit: 0 },
      ]),
    ).toEqual([]);
  });

  it("measures against the limit plus rollover carried in", () => {
    expect(categoriesNearLimit([{ id: "a", name: "A", total: 120, limit: 100, carried: 100 }])).toEqual([]);
    const [alert] = categoriesNearLimit([{ id: "a", name: "A", total: 190, limit: 100, carried: 100 }]);
    expect(alert).toMatchObject({ available: 200, over: false });
  });
});

describe("categoryEnvelopes (UX-138)", () => {
  const monthStart = new Date(2026, 9, 1);
  const monthEnd = new Date(2026, 10, 1);
  const category = (overrides: Record<string, unknown>) => ({
    id: "food",
    type: "EXPENSE" as "INCOME" | "EXPENSE" | "SAVINGS",
    monthlyLimit: 3000 as number | null,
    rolloverEnabled: false,
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  });
  const spend = (categoryId: string, amount: number, date: Date) => ({
    categoryId,
    type: "EXPENSE" as const,
    amount,
    date,
  });

  it("pairs each limited category's limit with this month's spending in it", () => {
    expect(
      categoryEnvelopes({
        categories: [category({})],
        transactions: [spend("food", 400, new Date(2026, 9, 3)), spend("food", 100, new Date(2026, 8, 20))],
        monthStart,
        monthEnd,
      }),
    ).toEqual([{ id: "food", spent: 400, available: 3000 }]);
  });

  it("skips categories without a usable limit and non-expense categories", () => {
    expect(
      categoryEnvelopes({
        categories: [
          category({ id: "a", monthlyLimit: null }),
          category({ id: "b", monthlyLimit: 0 }),
          category({ id: "c", type: "SAVINGS" }),
        ],
        transactions: [],
        monthStart,
        monthEnd,
      }),
    ).toEqual([]);
  });

  it("includes what rollover carries in, like the limit list", () => {
    const [envelope] = categoryEnvelopes({
      categories: [category({ rolloverEnabled: true, createdAt: new Date(2026, 7, 1) })],
      // August and September both unspent: 3000 + 3000 carried in.
      transactions: [],
      monthStart,
      monthEnd,
    });
    expect(envelope.available).toBe(9000);
  });
});
