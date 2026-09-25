import { describe, expect, it } from "vitest";
import {
  carryForward,
  computeCategoryRollover,
  rolloverStartMonth,
  withCategoryRollover,
  type RolloverCategory,
  type RolloverTransaction,
} from "@/lib/budget-rollover-calc";

// Local-time dates throughout, matching the pages' month boundaries.
const month = (year: number, m: number, day = 1) => new Date(year, m - 1, day);

function category(overrides: Partial<RolloverCategory> = {}): RolloverCategory {
  return {
    id: "food",
    monthlyLimit: 1000,
    rolloverEnabled: true,
    createdAt: month(2025, 6, 14),
    ...overrides,
  };
}

function spend(date: Date, amount: number, overrides: Partial<RolloverTransaction> = {}): RolloverTransaction {
  return { categoryId: "food", type: "EXPENSE", amount, date, ...overrides };
}

describe("carryForward", () => {
  it("accumulates each month's unspent limit", () => {
    expect(
      carryForward([
        { limit: 1000, spent: 800 },
        { limit: 1000, spent: 900 },
      ]),
    ).toBe(300);
  });

  it("lets overspending eat into the saved-up balance", () => {
    expect(
      carryForward([
        { limit: 1000, spent: 600 }, // +400
        { limit: 1000, spent: 1300 }, // −300 → 100
      ]),
    ).toBe(100);
  });

  it("clamps at zero after each month, so overspending never creates debt", () => {
    // Without the per-month clamp this would be −500 + 400 = −100 → 0; with
    // it, the overspent month bottoms out at 0 and the next month's 400 is
    // carried in full.
    expect(
      carryForward([
        { limit: 1000, spent: 1500 },
        { limit: 1000, spent: 600 },
      ]),
    ).toBe(400);
    expect(carryForward([{ limit: 1000, spent: 5000 }])).toBe(0);
  });

  it("carries the whole limit for a month with no spending", () => {
    expect(carryForward([{ limit: 500, spent: 0 }, { limit: 500, spent: 0 }])).toBe(1000);
  });

  it("uses each month's own limit when the limit changes", () => {
    expect(
      carryForward([
        { limit: 1000, spent: 900 }, // +100
        { limit: 1500, spent: 900 }, // +600 → 700
        { limit: 500, spent: 900 }, // −400 → 300
      ]),
    ).toBe(300);
  });

  it("is zero with no months to carry from", () => {
    expect(carryForward([])).toBe(0);
  });

  it("rounds away floating-point noise to cents", () => {
    expect(
      carryForward([
        { limit: 0.3, spent: 0.1 },
        { limit: 0.3, spent: 0.2 },
      ]),
    ).toBe(0.3);
  });

  it("ignores a negative spent figure (e.g. a refund netting a month below zero)", () => {
    expect(carryForward([{ limit: 100, spent: -50 }])).toBe(100);
  });
});

describe("rolloverStartMonth", () => {
  it("starts at January of the viewed year for a category created before it", () => {
    expect(rolloverStartMonth(month(2026, 9), month(2024, 3, 20))).toEqual(month(2026, 1));
  });

  it("starts at the category's creation month when that's later", () => {
    expect(rolloverStartMonth(month(2026, 9), month(2026, 4, 17))).toEqual(month(2026, 4));
  });

  it("can land after the viewed month for a category that didn't exist yet", () => {
    expect(rolloverStartMonth(month(2026, 2), month(2026, 5, 2))).toEqual(month(2026, 5));
  });
});

describe("computeCategoryRollover", () => {
  it("returns null when rollover is off or there's no usable limit", () => {
    const transactions = [spend(month(2026, 1, 5), 100)];
    const monthStart = month(2026, 3);
    expect(
      computeCategoryRollover({ category: category({ rolloverEnabled: false }), transactions, monthStart }),
    ).toBeNull();
    expect(
      computeCategoryRollover({ category: category({ monthlyLimit: null }), transactions, monthStart }),
    ).toBeNull();
    expect(
      computeCategoryRollover({ category: category({ monthlyLimit: 0 }), transactions, monthStart }),
    ).toBeNull();
  });

  it("carries earlier months' leftovers into the viewed month's available amount", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [
        spend(month(2026, 1, 3), 700),
        spend(month(2026, 1, 20), 100), // Jan: 800 → +200
        spend(month(2026, 2, 10), 950), // Feb: +50 → 250
        spend(month(2026, 3, 2), 400), // the viewed month itself: not carried
      ],
      monthStart: month(2026, 3),
    });
    expect(result).toEqual({ carried: 250, available: 1250, startMonth: month(2026, 1) });
  });

  it("counts a month with no transactions as fully unspent", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [spend(month(2026, 1, 3), 1000)], // Jan: 0; Feb: nothing → +1000
      monthStart: month(2026, 3),
    });
    expect(result?.carried).toBe(1000);
    expect(result?.available).toBe(2000);
  });

  it("clamps an overspent month at zero instead of carrying debt", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [
        spend(month(2026, 1, 3), 300), // +700
        spend(month(2026, 2, 3), 2500), // −1500 → 0, not −800
      ],
      monthStart: month(2026, 3),
    });
    expect(result).toMatchObject({ carried: 0, available: 1000 });
  });

  it("starts fresh each January, ignoring last year's leftovers", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [spend(month(2025, 11, 3), 0), spend(month(2025, 12, 3), 100)],
      monthStart: month(2026, 1),
    });
    expect(result).toEqual({ carried: 0, available: 1000, startMonth: month(2026, 1) });
  });

  it("starts at the category's creation month, ignoring backdated spending before it", () => {
    const result = computeCategoryRollover({
      category: category({ createdAt: month(2026, 4, 28) }),
      transactions: [
        spend(month(2026, 2, 1), 5000), // before the category existed
        spend(month(2026, 4, 30), 600), // Apr: +400
        // May: nothing → +1000
      ],
      monthStart: month(2026, 6),
    });
    expect(result).toEqual({ carried: 1400, available: 2400, startMonth: month(2026, 4) });
  });

  it("carries nothing in the creation month or a month before the category existed", () => {
    const created = category({ createdAt: month(2026, 6, 10) });
    expect(
      computeCategoryRollover({ category: created, transactions: [], monthStart: month(2026, 6) }),
    ).toMatchObject({ carried: 0, available: 1000 });
    expect(
      computeCategoryRollover({ category: created, transactions: [], monthStart: month(2026, 3) }),
    ).toMatchObject({ carried: 0, available: 1000 });
  });

  it("ignores other categories, non-expense rows and spending after the viewed month", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [
        spend(month(2026, 1, 5), 900, { categoryId: "fun" }),
        spend(month(2026, 1, 5), 900, { type: "INCOME" }),
        spend(month(2026, 1, 5), 900, { type: "SAVINGS" }),
        spend(month(2026, 3, 5), 900), // viewed month
        spend(month(2026, 4, 5), 900), // after it
      ],
      monthStart: month(2026, 3),
    });
    expect(result?.carried).toBe(2000);
  });

  it("applies the current limit to every month in the window (there's no limit history)", () => {
    const transactions = [spend(month(2026, 1, 5), 800), spend(month(2026, 2, 5), 800)];
    const monthStart = month(2026, 3);
    expect(
      computeCategoryRollover({ category: category({ monthlyLimit: 1000 }), transactions, monthStart })
        ?.carried,
    ).toBe(400);
    // Lowering the limit re-evaluates both earlier months at the new figure.
    expect(
      computeCategoryRollover({ category: category({ monthlyLimit: 900 }), transactions, monthStart })
        ?.carried,
    ).toBe(200);
  });

  it("accepts a monthStart that isn't the 1st, normalising it to its month", () => {
    const result = computeCategoryRollover({
      category: category(),
      transactions: [spend(month(2026, 1, 5), 900)],
      monthStart: month(2026, 2, 17),
    });
    expect(result?.carried).toBe(100);
  });
});

describe("withCategoryRollover", () => {
  const categories: RolloverCategory[] = [
    category(),
    category({ id: "fun", monthlyLimit: 200, rolloverEnabled: false }),
  ];
  const transactions = [spend(month(2026, 1, 5), 900)];

  it("attaches the carried balance to rollover-enabled rows only", () => {
    const rows = [
      { id: "food", name: "Food", total: 50, limit: 1000 },
      { id: "fun", name: "Fun", total: 20, limit: 200 },
      { id: "shared:rent", name: "Rent (shared)", total: 4000 },
    ];
    expect(withCategoryRollover(rows, categories, transactions, month(2026, 2))).toEqual([
      { id: "food", name: "Food", total: 50, limit: 1000, carried: 100 },
      { id: "fun", name: "Fun", total: 20, limit: 200 },
      { id: "shared:rent", name: "Rent (shared)", total: 4000 },
    ]);
  });

  it("returns the rows untouched when no category rolls over", () => {
    const rows = [{ id: "food", name: "Food", total: 50, limit: 1000 }];
    const result = withCategoryRollover(
      rows,
      [category({ rolloverEnabled: false })],
      transactions,
      month(2026, 2),
    );
    expect(result).toBe(rows);
  });
});
