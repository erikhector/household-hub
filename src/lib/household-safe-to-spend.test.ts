import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transactions: vi.fn(),
  templates: vi.fn(),
  acks: vi.fn(),
  planned: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: mocks.transactions },
    recurringTemplate: { findMany: mocks.templates },
    recurringTemplateAck: { findMany: mocks.acks },
    plannedExpense: { findMany: mocks.planned },
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
