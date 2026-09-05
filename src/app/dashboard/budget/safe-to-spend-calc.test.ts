import { describe, expect, it } from "vitest";
import { computeSafeToSpend, type SafeToSpendTransaction } from "./safe-to-spend-calc";

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
    });
    expect(result.safeToSpend).toBe(2500);
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
    });
    expect(result.safeToSpend).toBe(1000 - 5000);
  });
});
