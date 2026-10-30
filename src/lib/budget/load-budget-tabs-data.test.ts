// Tests loadBudgetTabsData (the query batch behind the household Budget page's
// tabs, MAINT-10) with Prisma mocked — no database is touched. The page's
// derivations are pinned elsewhere; this pins what is read: every query is
// scoped by the household id and the windows land where the page's comments
// say they do.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  categoryFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
  transactionGroupBy: vi.fn(),
  memberFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  ackFindMany: vi.fn(),
  settlementFindMany: vi.fn(),
  settlementGroupBy: vi.fn(),
  plannedFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetCategory: { findMany: m.categoryFindMany },
    transaction: { findMany: m.transactionFindMany, groupBy: m.transactionGroupBy },
    householdMember: { findMany: m.memberFindMany },
    recurringTemplate: { findMany: m.templateFindMany },
    recurringTemplateAck: { findMany: m.ackFindMany },
    memberSettlement: { findMany: m.settlementFindMany, groupBy: m.settlementGroupBy },
    plannedExpense: { findMany: m.plannedFindMany },
    $queryRaw: m.queryRaw,
  },
}));

import { loadBudgetTabsData, loadUnsettledSplitBills } from "./load-budget-tabs-data";

const monthStart = new Date("2026-10-01T00:00:00Z");
const monthEnd = new Date("2026-11-01T00:00:00Z");
const recurringLookbackStart = new Date("2025-11-01T00:00:00Z");
const trendWindowStart = new Date("2025-11-01T00:00:00Z");
const trendWindowEnd = new Date("2026-12-01T00:00:00Z");
const input = {
  householdId: "h1",
  monthStart,
  monthEnd,
  recurringLookbackStart,
  trendWindowStart,
  trendWindowEnd,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.categoryFindMany.mockResolvedValue([{ id: "c1" }]);
  m.transactionFindMany.mockResolvedValue([]);
  m.transactionGroupBy.mockResolvedValue([{ categoryId: "c1", _sum: { amount: 5 } }]);
  m.memberFindMany.mockResolvedValue([{ id: "m1" }]);
  m.templateFindMany.mockResolvedValue([{ id: "t1" }]);
  m.ackFindMany.mockResolvedValue([{ id: "a1" }]);
  m.settlementFindMany.mockResolvedValue([{ id: "s1" }]);
  m.settlementGroupBy.mockResolvedValue([]);
  m.plannedFindMany.mockResolvedValue([{ id: "p1" }]);
  m.queryRaw.mockResolvedValue([]);
});

describe("loadBudgetTabsData", () => {
  it("scopes every query by the household id", async () => {
    await loadBudgetTabsData(input);

    expect(m.categoryFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    for (const [arg] of m.transactionFindMany.mock.calls) {
      expect(arg.where.householdId).toBe("h1");
    }
    expect(m.transactionGroupBy.mock.calls[0][0].where).toEqual({ householdId: "h1", type: "SAVINGS" });
    expect(m.memberFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(m.templateFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(m.ackFindMany.mock.calls[0][0].where).toEqual({ recurringTemplate: { householdId: "h1" } });
    expect(m.settlementFindMany.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(m.settlementGroupBy.mock.calls[0][0].where).toEqual({ householdId: "h1" });
    expect(m.plannedFindMany.mock.calls[0][0].where.householdId).toBe("h1");
  });

  it("reads the viewed month, the lookback window and the trend window", async () => {
    await loadBudgetTabsData(input);

    const wheres = m.transactionFindMany.mock.calls.map(([arg]) => arg.where);
    expect(wheres).toContainEqual({ householdId: "h1", date: { gte: monthStart, lt: monthEnd } });
    expect(wheres).toContainEqual({
      householdId: "h1",
      date: { gte: recurringLookbackStart, lt: monthEnd },
    });
    expect(wheres).toContainEqual({
      householdId: "h1",
      recurringTemplateId: { not: null },
      date: { gte: trendWindowStart, lt: trendWindowEnd },
    });
  });

  it("limits the listed repayments and the recent-category sample", async () => {
    await loadBudgetTabsData(input);

    expect(m.settlementFindMany.mock.calls[0][0].take).toBe(10);
    const recent = m.transactionFindMany.mock.calls
      .map(([arg]) => arg)
      .find((arg) => arg.select?.categoryId && !arg.select.type);
    expect(recent.orderBy).toEqual({ createdAt: "desc" });
    expect(recent.take).toBeGreaterThan(0);
  });

  it("returns the rows from each query under the names the page reads", async () => {
    const data = await loadBudgetTabsData(input);

    expect(data.categories).toEqual([{ id: "c1" }]);
    expect(data.householdMembers).toEqual([{ id: "m1" }]);
    expect(data.recurringTemplates).toEqual([{ id: "t1" }]);
    expect(data.recurringTemplateAcks).toEqual([{ id: "a1" }]);
    expect(data.memberSettlements).toEqual([{ id: "s1" }]);
    expect(data.memberSettlementSums).toEqual([]);
    expect(data.savingsTotals).toEqual([{ categoryId: "c1", _sum: { amount: 5 } }]);
    expect(data.plannedExpenses).toEqual([{ id: "p1" }]);
    expect(data.splitTransactions).toEqual([]);
    expect(Object.keys(data)).toHaveLength(13);
  });
});

describe("loadUnsettledSplitBills", () => {
  it("skips the second query when no bill is unsettled", async () => {
    m.queryRaw.mockResolvedValue([]);
    await expect(loadUnsettledSplitBills("h1")).resolves.toEqual([]);
    expect(m.transactionFindMany).not.toHaveBeenCalled();
  });

  it("loads only the unsettled ids, newest first, within the household", async () => {
    m.queryRaw.mockResolvedValue([{ id: "x1" }, { id: "x2" }]);
    m.transactionFindMany.mockResolvedValue([{ id: "x1" }]);

    await expect(loadUnsettledSplitBills("h1")).resolves.toEqual([{ id: "x1" }]);
    const arg = m.transactionFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ householdId: "h1", id: { in: ["x1", "x2"] } });
    expect(arg.orderBy).toEqual({ date: "desc" });
  });
});
