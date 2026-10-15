// Tests loadPersonalBudgetPosition (the number behind Personal Budget's and
// the dashboard's "Remaining after expenses and savings") end to end over a
// realistic month, with Prisma mocked — no database is touched. See
// REQUIREMENTS.md's "Testing" section. The pure pieces it's built from have
// their own tests (safe-to-spend-calc.test.ts, settle-up-calc.test.ts); this
// one pins down how they're combined.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  personalTransactionFindManyMock,
  personalTemplateFindManyMock,
  personalAckFindManyMock,
  householdMemberFindManyMock,
  transactionFindManyMock,
  settlementFindManyMock,
  templateSplitFindManyMock,
  templateAckFindManyMock,
  templateFindManyMock,
  plannedSplitFindManyMock,
} = vi.hoisted(() => ({
  personalTransactionFindManyMock: vi.fn(),
  personalTemplateFindManyMock: vi.fn(),
  personalAckFindManyMock: vi.fn(),
  householdMemberFindManyMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
  settlementFindManyMock: vi.fn(),
  templateSplitFindManyMock: vi.fn(),
  templateAckFindManyMock: vi.fn(),
  templateFindManyMock: vi.fn(),
  plannedSplitFindManyMock: vi.fn(),
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
    recurringTemplate: { findMany: templateFindManyMock },
    plannedExpenseSplit: { findMany: plannedSplitFindManyMock },
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

function personalTemplate(id: string, type: "INCOME" | "EXPENSE" | "SAVINGS", amount: number) {
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

beforeEach(() => {
  plannedSplitFindManyMock.mockResolvedValue([]);
});

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
      dueIncome: 0,
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

  it("keeps a bill split by hand each month due in the months it isn't logged yet", async () => {
    // Viewing October: the household's rent and electricity templates have
    // no template split — September's bills were split by hand when logged.
    const octoberStart = new Date(2026, 9, 1);
    const octoberEnd = new Date(2026, 10, 1);
    personalTransactionFindManyMock.mockResolvedValue([]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    transactionFindManyMock.mockResolvedValue([
      {
        id: "sep-rent",
        amount: 12000,
        type: "EXPENSE",
        date: new Date(2026, 8, 1),
        recurringTemplateId: "tpl-rent",
        category: { name: "Rent" },
        splits: [split("m-me", "Me", 6000, 6000), split("m-p", "Partner", 6000, 6000)],
      },
      // An older, differently split rent bill — only the latest one counts.
      {
        id: "aug-rent",
        amount: 12000,
        type: "EXPENSE",
        date: new Date(2026, 7, 1),
        recurringTemplateId: "tpl-rent",
        category: { name: "Rent" },
        splits: [split("m-me", "Me", 3000, 3000), split("m-p", "Partner", 9000, 9000)],
      },
      // I only paid it, my partner's share: not a cost of mine.
      {
        id: "sep-power",
        amount: 800,
        type: "EXPENSE",
        date: new Date(2026, 8, 3),
        recurringTemplateId: "tpl-power",
        category: { name: "Power" },
        splits: [split("m-me", "Me", 0, 800), split("m-p", "Partner", 800, 0)],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);
    templateAckFindManyMock.mockResolvedValue([]);
    const template = (id: string, name: string, amount: number, latestBillId: string) => ({
      id,
      householdId: "h1",
      categoryId: `cat-${id}`,
      category: { name },
      name,
      amount,
      type: "EXPENSE",
      frequency: "MONTHLY",
      active: true,
      createdAt: new Date(2026, 0, 1),
      transactions: [{ id: latestBillId }],
    });
    // Rent went up to 13000 since September.
    templateFindManyMock.mockResolvedValue([
      template("tpl-rent", "Rent", 13000, "sep-rent"),
      template("tpl-power", "Power", 800, "sep-power"),
    ]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: octoberStart,
      monthEnd: octoberEnd,
      sharedLabel: "Shared",
    });

    // Scoped to the user's own households.
    expect(templateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["tpl-rent", "tpl-power"] }, householdId: { in: ["h1"] } },
      }),
    );
    expect(position.sharedDueRows).toEqual([
      expect.objectContaining({
        id: "tpl-rent",
        amount: 6500,
        householdName: "Home",
        logPrefill: expect.objectContaining({ amount: 13000, splits: { "m-me": 6500, "m-p": 6500 } }),
      }),
    ]);
    expect(position.safeToSpendBreakdown.duePayments).toBe(6500);
    // BUDGET-7: the same share feeds the Insights tab's fixed costs; the
    // payer-only electricity bill isn't one of mine.
    expect(position.sharedFixedTemplates).toEqual([
      expect.objectContaining({ id: "tpl-rent", name: "Rent", amount: 6500, type: "EXPENSE", active: true }),
    ]);
  });

  it("drops a hand-split bill once a later one is logged without the user", async () => {
    // Rent was split with me in August, but September's was logged unsplit
    // (it never reaches the split-bill query). October must not show it.
    personalTransactionFindManyMock.mockResolvedValue([]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    transactionFindManyMock.mockResolvedValue([
      {
        id: "aug-rent",
        amount: 12000,
        type: "EXPENSE",
        date: new Date(2026, 7, 1),
        recurringTemplateId: "tpl-rent",
        category: { name: "Rent" },
        splits: [split("m-me", "Me", 6000, 6000), split("m-p", "Partner", 6000, 6000)],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);
    templateAckFindManyMock.mockResolvedValue([]);
    templateFindManyMock.mockResolvedValue([
      {
        id: "tpl-rent",
        householdId: "h1",
        categoryId: "cat-rent",
        category: { name: "Rent" },
        name: "Rent",
        amount: 12000,
        type: "EXPENSE",
        frequency: "MONTHLY",
        active: true,
        createdAt: new Date(2026, 0, 1),
        transactions: [{ id: "sep-rent-unsplit" }],
      },
    ]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: new Date(2026, 9, 1),
      monthEnd: new Date(2026, 10, 1),
      sharedLabel: "Shared",
    });

    expect(position.sharedDueRows).toEqual([]);
    expect(position.safeToSpendBreakdown.duePayments).toBe(0);
  });

  it("counts recurring income not logged yet in a future month, own and shared", async () => {
    // Viewing October with nothing logged: the salary template and my share
    // of a household's split income template (a rented-out room, say) are
    // both still due, alongside the gym bill.
    personalTransactionFindManyMock.mockResolvedValue([]);
    personalTemplateFindManyMock.mockResolvedValue([
      personalTemplate("Salary", "INCOME", 30000),
      personalTemplate("Gym", "EXPENSE", 300),
    ]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    transactionFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([
      {
        recurringTemplateId: "tpl-room",
        householdMemberId: "m-me",
        amountOwed: 2000,
        recurringTemplate: {
          id: "tpl-room",
          householdId: "h1",
          categoryId: "cat-room",
          category: { name: "Room rental" },
          name: "Room rental",
          amount: 4000,
          type: "INCOME",
          frequency: "MONTHLY",
          active: true,
          createdAt: new Date(2026, 0, 1),
          splits: [
            { householdMemberId: "m-me", amountOwed: 2000 },
            { householdMemberId: "m-p", amountOwed: 2000 },
          ],
        },
      },
    ]);
    templateAckFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: new Date(2026, 9, 1),
      monthEnd: new Date(2026, 10, 1),
      sharedLabel: "Shared",
    });

    expect(position.safeToSpendBreakdown).toMatchObject({ income: 0, dueIncome: 32000, duePayments: 300 });
    expect(position.safeToSpend).toBe(32000 - 300);
    expect(position.expectedRecurring).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryName: "Salary", type: "INCOME", source: "personal" }),
        expect.objectContaining({ categoryName: "Room rental", type: "INCOME", source: "shared", amount: 2000 }),
      ]),
    );
    expect(position.sharedFixedTemplates).toEqual([
      expect.objectContaining({ id: "tpl-room", amount: 2000, type: "INCOME", frequency: "MONTHLY" }),
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
    expect(position.sharedFixedTemplates).toEqual([]);
    expect(transactionFindManyMock).not.toHaveBeenCalled();
    // No `now` in September 2026 (the test runs later), so no projection.
    expect(position.safeToSpendProjection).toBeNull();
  });

  it("projects the number to month end from everyday spending only (UX-39)", async () => {
    personalTransactionFindManyMock.mockResolvedValue([
      personalTx("Salary", "INCOME", 3000, 1),
      personalTx("Food", "EXPENSE", 100, 2),
      personalTx("Coffee", "EXPENSE", 50, 9),
      // A bill logged from a recurring item is in the number, not the pace.
      personalTx("Phone", "EXPENSE", 400, 3, "tpl-phone"),
    ]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart,
      monthEnd,
      sharedLabel: "Shared",
      now: new Date(2026, 8, 10, 12),
    });

    expect(position.safeToSpend).toBe(2450);
    // 150 of everyday spending over 10 days → 15 a day, for 20 more days.
    expect(position.safeToSpendProjection?.dailyPace).toBe(15);
    expect(position.safeToSpendProjection?.projected).toBe(2450 - 15 * 20);
  });
  describe("planned bills (BUDGET-8)", () => {
    function setup(plannedSplits: unknown[]) {
      personalTransactionFindManyMock.mockResolvedValue([personalTx("Salary", "INCOME", 30000, 5)]);
      personalTemplateFindManyMock.mockResolvedValue([]);
      personalAckFindManyMock.mockResolvedValue([]);
      householdMemberFindManyMock.mockResolvedValue([{ id: "m1", household: { id: "h1", name: "Home" } }]);
      transactionFindManyMock.mockResolvedValue([]);
      settlementFindManyMock.mockResolvedValue([]);
      templateSplitFindManyMock.mockResolvedValue([]);
      templateAckFindManyMock.mockResolvedValue([]);
      templateFindManyMock.mockResolvedValue([]);
      plannedSplitFindManyMock.mockResolvedValue(plannedSplits);
    }
    const bill = (transaction: { date: Date } | null) => ({
      householdMemberId: "m1",
      amountOwed: 1500,
      plannedExpense: {
        id: "p1",
        name: "Car repair",
        amount: 3000,
        householdId: "h1",
        dueDate: new Date(2026, 8, 15),
        category: { name: "Car" },
        transaction,
      },
    });
    const load = () =>
      loadPersonalBudgetPosition({ userId: "user-1", monthStart, monthEnd, sharedLabel: "Shared" });

    it("adds the user's share of an outstanding planned bill", async () => {
      setup([bill(null)]);
      const position = await load();
      expect(position.sharedDueRows).toEqual([
        expect.objectContaining({ id: "p1", name: "Car repair", categoryName: "Car", amount: 1500, type: "EXPENSE", householdName: "Home" }),
      ]);
      expect(position.sharedDueRows[0].logPrefill).toBeUndefined();
      expect(position.safeToSpendBreakdown.duePayments).toBe(1500);
    });

    it("bounds the query to the user's members and the viewed month", async () => {
      setup([]);
      await load();
      expect(plannedSplitFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            householdMemberId: { in: ["m1"] },
            amountOwed: { gt: 0 },
            plannedExpense: {
              dueDate: { lt: monthEnd },
              // Bills paid before the month are history; leave them in the DB.
              OR: [
                { transaction: { is: null } },
                { transaction: { is: { date: { gte: monthStart } } } },
              ],
            },
          },
        }),
      );
    });

    it("does not add a bill paid before the month ends", async () => {
      setup([bill({ date: new Date(2026, 8, 20) })]);
      const position = await load();
      expect(position.sharedDueRows).toEqual([]);
      expect(position.safeToSpendBreakdown.duePayments).toBe(0);
    });
  });
});
