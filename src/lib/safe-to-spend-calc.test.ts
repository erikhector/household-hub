import { describe, expect, it } from "vitest";
import { computeSafeToSpend, type SafeToSpendTransaction } from "@/lib/safe-to-spend-calc";

const monthStart = new Date(2026, 8, 1); // Sept 2026
const monthEnd = new Date(2026, 9, 1);

function tx(overrides: Partial<SafeToSpendTransaction>): SafeToSpendTransaction {
  return {
    categoryId: "cat-1",
    categoryName: "Rent",
    type: "EXPENSE",
    amount: 1200,
    date: new Date(2026, 7, 1),
    isRecurring: true,
    ...overrides,
  };
}

describe("computeSafeToSpend", () => {
  it("subtracts nothing when there are no recurring categories", () => {
    const result = computeSafeToSpend({
      transactions: [],
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 0,
    });
    expect(result.safeToSpend).toBe(2500);
    expect(result.expectedRecurring).toEqual([]);
  });

  it("subtracts savings so far from the headline number, same as expenses", () => {
    const result = computeSafeToSpend({
      transactions: [],
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 400,
    });
    expect(result.safeToSpend).toBe(3000 - 500 - 400);
  });

  it("ignores SAVINGS transactions in the recurring 'not yet logged' estimate", () => {
    const transactions = [
      tx({ type: "SAVINGS", categoryId: "cat-savings", categoryName: "Emergency fund", date: new Date(2026, 7, 1) }),
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 1000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([]);
  });

  it("estimates a recurring expense category that hasn't posted this month", () => {
    const transactions = [tx({ date: new Date(2026, 7, 1) })]; // August, prior month
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([
      { categoryId: "cat-1", categoryName: "Rent", amount: 1200 },
    ]);
    expect(result.safeToSpend).toBe(3000 - 500 - 1200);
  });

  it("does not estimate a category that already posted this month", () => {
    const transactions = [
      tx({ date: new Date(2026, 7, 1) }), // prior recurring
      tx({ date: new Date(2026, 8, 3), isRecurring: false, amount: 1250 }), // already logged this month
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 1250,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([]);
    expect(result.safeToSpend).toBe(3000 - 1250);
  });

  it("ignores a category with no recurring transaction in a prior month", () => {
    const transactions = [tx({ isRecurring: false, date: new Date(2026, 7, 1) })];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 1000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([]);
  });

  it("ignores INCOME transactions entirely", () => {
    const transactions = [
      tx({ type: "INCOME", categoryId: "cat-income", categoryName: "Salary", date: new Date(2026, 7, 1) }),
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 1000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([]);
  });

  it("uses the most recent recurring transaction's amount when there are several", () => {
    const transactions = [
      tx({ date: new Date(2026, 5, 1), amount: 1000 }),
      tx({ date: new Date(2026, 6, 1), amount: 1100 }),
      tx({ date: new Date(2026, 7, 1), amount: 1200 }),
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([
      { categoryId: "cat-1", categoryName: "Rent", amount: 1200 },
    ]);
  });

  it("sums multiple categories' expected amounts and sorts largest-first", () => {
    const transactions = [
      tx({ categoryId: "cat-1", categoryName: "Rent", amount: 1200, date: new Date(2026, 7, 1) }),
      tx({ categoryId: "cat-2", categoryName: "Internet", amount: 60, date: new Date(2026, 7, 1) }),
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([
      { categoryId: "cat-1", categoryName: "Rent", amount: 1200 },
      { categoryId: "cat-2", categoryName: "Internet", amount: 60 },
    ]);
    expect(result.safeToSpend).toBe(3000 - 1260);
  });

  it("can produce a negative safe-to-spend number", () => {
    const transactions = [tx({ date: new Date(2026, 7, 1), amount: 5000 })];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 1000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.safeToSpend).toBe(1000 - 5000);
  });

  it("handles a month with zero transactions at all", () => {
    const result = computeSafeToSpend({
      transactions: [],
      monthStart,
      monthEnd,
      incomeSoFar: 0,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.safeToSpend).toBe(0);
    expect(result.expectedRecurring).toEqual([]);
  });

  it("does not estimate a recurring category whose only transaction is dated in a future month", () => {
    // The category's sole transaction is recurring, but dated in October —
    // a future month relative to the September [monthStart, monthEnd)
    // window — so it isn't "prior" (t.date < monthStart) and shouldn't be
    // treated as an unposted expected expense for the current month per
    // REQUIREMENTS.md's "The recurring-expense estimate".
    const transactions = [tx({ date: new Date(2026, 9, 15) })]; // October, future month
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual([]);
    expect(result.safeToSpend).toBe(3000);
  });

  it("includes recurring transactions with a zero or negative amount in the estimate", () => {
    const transactions = [
      tx({
        categoryId: "cat-zero",
        categoryName: "Zero Fee",
        amount: 0,
        date: new Date(2026, 7, 1),
      }),
      tx({
        categoryId: "cat-negative",
        categoryName: "Rebate",
        amount: -50,
        date: new Date(2026, 7, 1),
      }),
    ];
    const result = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 0,
      savingsSoFar: 0,
    });
    expect(result.expectedRecurring).toEqual(
      expect.arrayContaining([
        { categoryId: "cat-zero", categoryName: "Zero Fee", amount: 0 },
        { categoryId: "cat-negative", categoryName: "Rebate", amount: -50 },
      ]),
    );
    expect(result.expectedRecurring).toHaveLength(2);
    // Expected total is 0 + (-50) = -50, so it *adds* 50 to safe-to-spend.
    expect(result.safeToSpend).toBe(3000 - 0 - -50);
  });

  describe("status", () => {
    it("is 'over' once safe-to-spend goes negative", () => {
      const result = computeSafeToSpend({
        transactions: [],
        monthStart,
        monthEnd,
        incomeSoFar: 1000,
        expenseSoFar: 1050,
        savingsSoFar: 0,
      });
      expect(result.safeToSpend).toBe(-50);
      expect(result.status).toBe("over");
    });

    it("is 'tight' once what's left drops under 10% of income so far", () => {
      const result = computeSafeToSpend({
        transactions: [],
        monthStart,
        monthEnd,
        incomeSoFar: 1000,
        expenseSoFar: 920, // 80 left, exactly 8% of income
        savingsSoFar: 0,
      });
      expect(result.safeToSpend).toBe(80);
      expect(result.status).toBe("tight");
    });

    it("is 'healthy' when comfortably above the tight threshold", () => {
      const result = computeSafeToSpend({
        transactions: [],
        monthStart,
        monthEnd,
        incomeSoFar: 1000,
        expenseSoFar: 500,
        savingsSoFar: 0,
      });
      expect(result.safeToSpend).toBe(500);
      expect(result.status).toBe("healthy");
    });

    it("is 'healthy' for a non-negative balance when no income has posted yet, rather than guessing 'tight'", () => {
      const result = computeSafeToSpend({
        transactions: [],
        monthStart,
        monthEnd,
        incomeSoFar: 0,
        expenseSoFar: 0,
        savingsSoFar: 0,
      });
      expect(result.safeToSpend).toBe(0);
      expect(result.status).toBe("healthy");
    });
  });
});
