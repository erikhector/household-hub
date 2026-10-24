import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transactions: vi.fn(),
  templates: vi.fn(),
  acks: vi.fn(),
  planned: vi.fn(),
  categories: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: mocks.transactions },
    recurringTemplate: { findMany: mocks.templates },
    recurringTemplateAck: { findMany: mocks.acks },
    plannedExpense: { findMany: mocks.planned },
    budgetCategory: { findMany: mocks.categories },
  },
}));

import { loadHouseholdSafeToSpend } from "./household-safe-to-spend";

const NOW = new Date(2026, 9, 18, 12);

function tx(type: "INCOME" | "EXPENSE" | "SAVINGS", amount: number, date: Date, categoryId = "c1") {
  return {
    categoryId,
    category: { name: categoryId },
    type,
    amount,
    date,
    isRecurring: false,
    recurringTemplateId: null,
  };
}

describe("loadHouseholdSafeToSpend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactions.mockResolvedValue([]);
    mocks.templates.mockResolvedValue([]);
    mocks.acks.mockResolvedValue([]);
    mocks.planned.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
  });

  it("is this month's income minus expenses and savings so far", async () => {
    mocks.transactions.mockResolvedValue([
      tx("INCOME", 1000, new Date(2026, 9, 2), "salary"),
      tx("EXPENSE", 300, new Date(2026, 9, 5), "food"),
      tx("SAVINGS", 100, new Date(2026, 9, 6), "buffer"),
    ]);
    const result = await loadHouseholdSafeToSpend("h1", NOW);
    expect(result.amount).toBe(600);
    expect(result.status).toBe("healthy");
  });

  it("ignores earlier months' transactions (the lookback only feeds the recurring estimate)", async () => {
    mocks.transactions.mockResolvedValue([
      tx("INCOME", 5000, new Date(2026, 8, 2), "salary"),
      tx("EXPENSE", 200, new Date(2026, 9, 5), "food"),
    ]);
    const result = await loadHouseholdSafeToSpend("h1", NOW);
    expect(result.amount).toBe(-200);
    expect(result.status).toBe("over");
  });

  it("scopes every query to the household", async () => {
    await loadHouseholdSafeToSpend("h1", NOW);
    expect(mocks.transactions.mock.calls[0][0].where.householdId).toBe("h1");
    expect(mocks.templates.mock.calls[0][0].where).toEqual({ householdId: "h1", active: true });
    expect(mocks.acks.mock.calls[0][0].where).toEqual({ recurringTemplate: { householdId: "h1" } });
    expect(mocks.planned.mock.calls[0][0].where.householdId).toBe("h1");
    expect(mocks.categories.mock.calls[0][0].where.householdId).toBe("h1");
  });

  it("holds back what is still unspent of a category limit (UX-138)", async () => {
    mocks.transactions.mockResolvedValue([
      tx("INCOME", 10000, new Date(2026, 9, 2), "salary"),
      tx("EXPENSE", 1200, new Date(2026, 9, 5), "food"),
    ]);
    mocks.categories.mockResolvedValue([
      { id: "food", type: "EXPENSE", monthlyLimit: 3000, rolloverEnabled: false, createdAt: new Date(2026, 0, 1) },
    ]);
    const result = await loadHouseholdSafeToSpend("h1", NOW);
    expect(result.amount).toBe(10000 - 1200 - 1800);
  });

  it("subtracts a planned bill that is due and unpaid", async () => {
    mocks.transactions.mockResolvedValue([tx("INCOME", 1000, new Date(2026, 9, 2), "salary")]);
    mocks.planned.mockResolvedValue([
      {
        id: "p1",
        name: "Dentist",
        amount: 250,
        dueDate: new Date(2026, 9, 25),
        category: { type: "EXPENSE" },
        transaction: null,
      },
    ]);
    const result = await loadHouseholdSafeToSpend("h1", NOW);
    expect(result.amount).toBe(750);
  });

  it("adds planned income expected this month, but not income that's late", async () => {
    mocks.transactions.mockResolvedValue([tx("INCOME", 1000, new Date(2026, 9, 2), "salary")]);
    mocks.planned.mockResolvedValue([
      {
        id: "p1",
        name: "Tax refund",
        amount: 400,
        dueDate: new Date(2026, 9, 25),
        category: { type: "INCOME" },
        transaction: null,
      },
      {
        id: "p2",
        name: "Bonus",
        amount: 5000,
        dueDate: new Date(2026, 8, 25),
        category: { type: "INCOME" },
        transaction: null,
      },
    ]);
    const result = await loadHouseholdSafeToSpend("h1", NOW);
    expect(result.amount).toBe(1400);
  });
});

// UX-134: with the budget month starting on the 25th, 28 September is in
// "October" (25 Sep to 24 Oct), so October's rent logged then belongs to it.
describe("loadHouseholdSafeToSpend with a budget month starting on the 25th (UX-134)", () => {
  const START_DAY = 25;
  const TODAY = new Date(2026, 8, 30, 12);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactions.mockResolvedValue([]);
    mocks.templates.mockResolvedValue([]);
    mocks.acks.mockResolvedValue([]);
    mocks.planned.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
  });

  it("queries and sums the 25th-to-24th period", async () => {
    mocks.transactions.mockResolvedValue([
      tx("INCOME", 30000, new Date(2026, 8, 25), "salary"),
      tx("EXPENSE", 12500, new Date(2026, 8, 28), "rent"),
      // Before the period starts: September's, not this one's.
      tx("EXPENSE", 999, new Date(2026, 8, 24), "food"),
    ]);

    const result = await loadHouseholdSafeToSpend("h1", TODAY, START_DAY);

    expect(result.amount).toBe(30000 - 12500);
    expect(mocks.transactions.mock.calls[0][0].where.date.lt).toEqual(new Date(2026, 9, 25));
  });

  it("counts a rent logged on 28 September against the period, so its template is no longer due", async () => {
    mocks.templates.mockResolvedValue([
      {
        id: "rent",
        name: "Rent",
        categoryId: "rent",
        type: "EXPENSE",
        amount: 12500,
        frequency: "MONTHLY",
        active: true,
        createdAt: new Date(2026, 0, 1),
      },
    ]);
    mocks.transactions.mockResolvedValue([
      { ...tx("EXPENSE", 12500, new Date(2026, 8, 28), "rent"), recurringTemplateId: "rent" },
    ]);

    const result = await loadHouseholdSafeToSpend("h1", TODAY, START_DAY);

    // Spent once (-12,500), not again as a bill still due.
    expect(result.amount).toBe(-12500);
  });

  it("still counts that rent as due under calendar months", async () => {
    mocks.templates.mockResolvedValue([
      {
        id: "rent",
        name: "Rent",
        categoryId: "rent",
        type: "EXPENSE",
        amount: 12500,
        frequency: "MONTHLY",
        active: true,
        createdAt: new Date(2026, 0, 1),
      },
    ]);
    mocks.transactions.mockResolvedValue([
      { ...tx("EXPENSE", 12500, new Date(2026, 8, 28), "rent"), recurringTemplateId: "rent" },
    ]);

    const result = await loadHouseholdSafeToSpend("h1", TODAY);

    expect(result.amount).toBe(-12500);
  });
});
