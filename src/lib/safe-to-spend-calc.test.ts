import { describe, expect, it } from "vitest";
import {
  computeSafeToSpend,
  deriveSafeToSpend,
  needsSafeToSpendSetup,
  type SafeToSpendTransaction,
} from "@/lib/safe-to-spend-calc";

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

describe("deriveSafeToSpend", () => {
  it("matches computeSafeToSpend's own result when fed the same expectedRecurring list", () => {
    const transactions = [tx({ date: new Date(2026, 7, 1) })];
    const computed = computeSafeToSpend({
      transactions,
      monthStart,
      monthEnd,
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 0,
    });
    const derived = deriveSafeToSpend({
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 0,
      expectedRecurring: computed.expectedRecurring,
    });
    expect(derived.safeToSpend).toBe(computed.safeToSpend);
    expect(derived.status).toBe(computed.status);
  });

  it("lets a caller fold in extra (e.g. shared-household) rows a category-based estimate can't know about", () => {
    // docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md's "Rent pops up" case: a due shared
    // RecurringTemplate's per-member share, tagged source: "shared", added
    // on top of whatever computeSafeToSpend already estimated from the
    // user's own personal transactions.
    const result = deriveSafeToSpend({
      incomeSoFar: 3000,
      expenseSoFar: 500,
      savingsSoFar: 0,
      expectedRecurring: [
        { categoryId: "cat-1", categoryName: "Subscriptions", amount: 20, source: "personal" },
        {
          categoryId: "template-1",
          categoryName: "Rent",
          amount: 400,
          source: "shared",
          householdName: "The Loft",
        },
      ],
    });
    expect(result.safeToSpend).toBe(3000 - 500 - 20 - 400);
    expect(result.status).toBe("healthy");
  });

  it("still reports 'over' once the combined total pushes safe-to-spend negative", () => {
    const result = deriveSafeToSpend({
      incomeSoFar: 1000,
      expenseSoFar: 700,
      savingsSoFar: 0,
      expectedRecurring: [
        { categoryId: "template-1", categoryName: "Rent", amount: 400, source: "shared" },
      ],
    });
    expect(result.safeToSpend).toBe(1000 - 700 - 400);
    expect(result.status).toBe("over");
  });
});

describe("computeSafeToSpend with recurring items", () => {
  const base = {
    monthStart,
    monthEnd,
    incomeSoFar: 30000,
    expenseSoFar: 0,
    savingsSoFar: 0,
  };

  it("subtracts due payments and due savings separately", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 8000, status: "due" },
        { id: "t2", name: "Buffer", categoryId: "sav", type: "SAVINGS", amount: 5000, status: "due" },
      ],
    });
    expect(result.safeToSpend).toBe(17000);
    expect(result.breakdown).toMatchObject({ duePayments: 8000, dueSavings: 5000, dueIncome: 0 });
    expect(result.expectedRecurring.map((e) => e.categoryName)).toEqual(["Rent", "Buffer"]);
  });

  it("adds a recurring income that hasn't come in yet as expected income", () => {
    // A future month: nothing logged, so only the recurring items speak.
    // Before, the salary was ignored and the month read -13000.
    const result = computeSafeToSpend({
      ...base,
      incomeSoFar: 0,
      transactions: [],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 8000, status: "due" },
        { id: "t2", name: "Buffer", categoryId: "sav", type: "SAVINGS", amount: 5000, status: "due" },
        { id: "t3", name: "Salary", categoryId: "sal", type: "INCOME", amount: 30000, status: "due" },
      ],
    });
    expect(result.safeToSpend).toBe(17000);
    expect(result.status).toBe("healthy");
    expect(result.breakdown).toMatchObject({ income: 0, dueIncome: 30000, duePayments: 8000, dueSavings: 5000 });
    expect(result.expectedRecurring).toContainEqual({
      categoryId: "t3",
      categoryName: "Salary",
      amount: 30000,
      type: "INCOME",
    });
  });

  it("counts a logged salary only through its transaction, not again as expected", () => {
    const result = computeSafeToSpend({
      ...base,
      incomeSoFar: 28000,
      transactions: [],
      templates: [
        { id: "t3", name: "Salary", categoryId: "sal", type: "INCOME", amount: 30000, status: "posted" },
      ],
    });
    expect(result.safeToSpend).toBe(28000);
    expect(result.breakdown.dueIncome).toBe(0);
    expect(result.expectedRecurring).toEqual([]);
  });

  it("judges 'tight' against expected income too", () => {
    const result = computeSafeToSpend({
      ...base,
      incomeSoFar: 0,
      transactions: [],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 9500, status: "due" },
        { id: "t3", name: "Salary", categoryId: "sal", type: "INCOME", amount: 10000, status: "due" },
      ],
    });
    expect(result.safeToSpend).toBe(500);
    expect(result.status).toBe("tight");
  });

  it("counts only what was actually saved once a saving is logged for less than planned", () => {
    // Planned 5000, logged 3000: the template is posted, so only the 3000
    // saving reduces the number — the 2000 not saved stays spendable.
    const result = computeSafeToSpend({
      ...base,
      savingsSoFar: 3000,
      transactions: [],
      templates: [
        { id: "t2", name: "Buffer", categoryId: "sav", type: "SAVINGS", amount: 5000, status: "posted" },
      ],
    });
    expect(result.safeToSpend).toBe(27000);
    expect(result.breakdown.dueSavings).toBe(0);
  });

  it("treats an acknowledged item as handled", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 8000, status: "acknowledged" },
      ],
    });
    expect(result.safeToSpend).toBe(30000);
  });

  it("doesn't also estimate a category that has a recurring item", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [tx({ categoryId: "rent", amount: 7000 })],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 8000, status: "due" },
      ],
    });
    expect(result.expectedRecurring).toHaveLength(1);
    expect(result.safeToSpend).toBe(22000);
  });

  it("still estimates categories without a recurring item", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [tx({ categoryId: "gym", categoryName: "Gym", amount: 300 })],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE", amount: 8000, status: "posted" },
      ],
    });
    expect(result.expectedRecurring).toEqual([{ categoryId: "gym", categoryName: "Gym", amount: 300 }]);
    expect(result.safeToSpend).toBe(29700);
  });

  it("subtracts what was still owed from earlier months", () => {
    const result = computeSafeToSpend({ ...base, transactions: [], owedFromEarlier: 3000 });
    expect(result.safeToSpend).toBe(27000);
    expect(result.breakdown.owedFromEarlier).toBe(3000);
  });
});

describe("computeSafeToSpend with planned bills", () => {
  const base = {
    monthStart,
    monthEnd,
    incomeSoFar: 20000,
    expenseSoFar: 0,
    savingsSoFar: 0,
  };

  it("adds due and overdue planned bills to due payments", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [],
      plannedExpenses: [
        { id: "p1", name: "Car repair", amount: 3000, status: "due" },
        { id: "p2", name: "Dentist", amount: 800, status: "overdue" },
      ],
    });
    expect(result.breakdown.duePayments).toBe(3800);
    expect(result.safeToSpend).toBe(16200);
    expect(result.expectedRecurring).toContainEqual({
      categoryId: "p1",
      categoryName: "Car repair",
      amount: 3000,
      type: "EXPENSE",
    });
  });

  it("ignores upcoming and paid planned bills", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [],
      plannedExpenses: [
        { id: "p1", name: "Holiday", amount: 9000, status: "upcoming" },
        { id: "p2", name: "Dentist", amount: 800, status: "paid" },
      ],
    });
    expect(result.breakdown.duePayments).toBe(0);
    expect(result.expectedRecurring).toEqual([]);
  });

  it("does not suppress the repeat estimate", () => {
    const result = computeSafeToSpend({
      ...base,
      transactions: [tx({ categoryId: "c1", categoryName: "Gym", amount: 500 })],
      plannedExpenses: [{ id: "p1", name: "Car repair", amount: 3000, status: "due" }],
    });
    expect(result.expectedRecurring).toContainEqual({
      categoryId: "c1",
      categoryName: "Gym",
      amount: 500,
    });
    expect(result.breakdown.duePayments).toBe(500 + 3000);
  });

  it("gives an identical result with no planned bills", () => {
    const input = {
      ...base,
      transactions: [tx({ categoryId: "gym", categoryName: "Gym", amount: 300 })],
      templates: [
        { id: "t1", name: "Rent", categoryId: "rent", type: "EXPENSE" as const, amount: 8000, status: "due" as const },
      ],
    };
    expect(computeSafeToSpend({ ...input, plannedExpenses: [] })).toEqual(computeSafeToSpend(input));
  });
});

describe("needsSafeToSpendSetup", () => {
  const empty = { income: 0, dueIncome: 0, expense: 0, savings: 0, owedFromEarlier: 0, duePayments: 0, dueSavings: 0 };

  it("is true with no income and nothing recurring or due", () => {
    expect(needsSafeToSpendSetup(empty, [])).toBe(true);
  });

  it("is false once there is income, expected income or a due payment", () => {
    expect(needsSafeToSpendSetup({ ...empty, income: 100 }, [])).toBe(false);
    expect(needsSafeToSpendSetup({ ...empty, dueIncome: 100 }, [])).toBe(false);
    expect(needsSafeToSpendSetup({ ...empty, duePayments: 50 }, [])).toBe(false);
  });

  it("is false when a recurring item is expected", () => {
    expect(needsSafeToSpendSetup(empty, [{ categoryId: "c" }])).toBe(false);
  });
});
