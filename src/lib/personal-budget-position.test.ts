// Tests loadPersonalBudgetPosition (the number behind Personal Budget's and
// the dashboard's "Remaining after expenses and savings") end to end over a
// realistic month, with Prisma mocked — no database is touched. See
// REQUIREMENTS.md's "Testing" section. The pure pieces it's built from have
// their own tests (safe-to-spend-calc.test.ts, settle-up-calc.test.ts); this
// one pins down how they're combined.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  personalTransactionFindManyMock,
  personalTemplateFindManyMock,
  personalAckFindManyMock,
  householdMemberFindManyMock,
  transactionFindManyMock,
  settlementFindManyMock,
  templateSplitFindManyMock,
  templateAckFindManyMock,
} = vi.hoisted(() => ({
  personalTransactionFindManyMock: vi.fn(),
  personalTemplateFindManyMock: vi.fn(),
  personalAckFindManyMock: vi.fn(),
  householdMemberFindManyMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
  settlementFindManyMock: vi.fn(),
  templateSplitFindManyMock: vi.fn(),
  templateAckFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalTransaction: { findMany: personalTransactionFindManyMock },
    personalRecurringTemplate: { findMany: personalTemplateFindManyMock },
    personalRecurringTemplateAck: { findMany: personalAckFindManyMock },
    householdMember: { findMany: householdMemberFindManyMock },
    transaction: { findMany: transactionFindManyMock },
    memberSettlement: { findMany: settlementFindManyMock },
    recurringTemplateSplit: { findMany: templateSplitFindManyMock },
    recurringTemplateAck: { findMany: templateAckFindManyMock },
  },
}));

import { loadPersonalBudgetPosition } from "./personal-budget-position";

const monthStart = new Date(2026, 8, 1); // September 2026
const monthEnd = new Date(2026, 9, 1);

function personalTx(
  id: string,
  type: "INCOME" | "EXPENSE" | "SAVINGS",
  amount: number,
  day: number,
  recurringTemplateId: string | null = null,
) {
  return {
    id,
    categoryId: `cat-${id}`,
    category: { name: id },
    type,
    amount,
    date: new Date(2026, 8, day),
    isRecurring: false,
    recurringTemplateId,
  };
}

function personalTemplate(id: string, type: "EXPENSE" | "SAVINGS", amount: number) {
  return {
    id,
    name: id,
    categoryId: `tpl-cat-${id}`,
    category: { name: id },
    type,
    amount,
    frequency: "MONTHLY",
    active: true,
    createdAt: new Date(2026, 0, 1),
  };
}

function split(memberId: string, name: string, amountOwed: number, amountPaid: number) {
  return {
    id: `split-${memberId}-${amountOwed}-${amountPaid}`,
    householdMemberId: memberId,
    amountOwed,
    amountPaid,
    householdMember: { user: { displayName: name } },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPersonalBudgetPosition", () => {
  it("combines own and shared money, carried debts and what's still due", async () => {
    personalTransactionFindManyMock.mockResolvedValue([
      personalTx("Salary", "INCOME", 30000, 5),
      personalTx("Groceries", "EXPENSE", 2000, 6),
      // Planned 5000, saved 3000: only the 3000 counts, nothing stays due.
      personalTx("Buffer", "SAVINGS", 3000, 7, "Buffer"),
    ]);
    personalTemplateFindManyMock.mockResolvedValue([
      personalTemplate("Buffer", "SAVINGS", 5000),
      personalTemplate("Gym", "EXPENSE", 300),
      personalTemplate("Holiday", "SAVINGS", 1000),
    ]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    transactionFindManyMock.mockResolvedValue([
      // September rent: I paid my half, my partner hasn't paid theirs yet.
      {
        id: "rent",
        amount: 12000,
        type: "EXPENSE",
        date: new Date(2026, 8, 1),
        category: { name: "Rent" },
        splits: [split("m-me", "Me", 6000, 6000), split("m-p", "Partner", 6000, 0)],
      },
      // August groceries my partner paid in full: I owe them 1000.
      {
        id: "aug-groceries",
        amount: 2000,
        type: "EXPENSE",
        date: new Date(2026, 7, 20),
        category: { name: "Groceries" },
        splits: [split("m-me", "Me", 1000, 0), split("m-p", "Partner", 1000, 2000)],
      },
    ]);
    // Paid 400 of the August debt back in September.
    settlementFindManyMock.mockResolvedValue([
      { fromMemberId: "m-me", toMemberId: "m-p", amount: 400, date: new Date(2026, 8, 10) },
    ]);
    templateSplitFindManyMock.mockResolvedValue([]);
    templateAckFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart,
      monthEnd,
      sharedLabel: "Shared",
    });

    expect(position.safeToSpendBreakdown).toEqual({
      income: 30000,
      // Own groceries + my 6000 share of the rent (whoever paid it).
      expense: 8000,
      savings: 3000,
      // The August debt as it stood on 1 September — the repayment on the
      // 10th doesn't count twice.
      owedFromEarlier: 1000,
      duePayments: 300,
      dueSavings: 1000,
    });
    expect(position.safeToSpend).toBe(30000 - 8000 - 3000 - 1000 - 300 - 1000);
    expect(position.expectedRecurring.map((e) => e.categoryName).sort()).toEqual(["Gym", "Holiday"]);

    // The rent shows as my share with the partner's half still left due.
    expect(position.sharedPostedRows).toEqual([
      expect.objectContaining({ categoryName: "Rent", amount: 6000, yourPaid: 6000, leftDue: 6000 }),
    ]);
    // Where things stand at the end of September: 600 left of the debt.
    expect(position.householdDebts).toEqual([
      { householdId: "h1", householdName: "Home", owedToMembers: 600, owedToBills: 0 },
    ]);
  });

  it("works with no household at all", async () => {
    personalTransactionFindManyMock.mockResolvedValue([personalTx("Salary", "INCOME", 1000, 5)]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart,
      monthEnd,
      sharedLabel: "Shared",
    });

    expect(position.safeToSpend).toBe(1000);
    expect(position.householdDebts).toEqual([]);
    expect(transactionFindManyMock).not.toHaveBeenCalled();
  });
});
