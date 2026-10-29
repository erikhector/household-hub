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
  settlementGroupByMock,
  transactionGroupByMock,
  queryRawMock,
  templateSplitFindManyMock,
  templateAckFindManyMock,
  templateFindManyMock,
  plannedSplitFindManyMock,
  personalPlannedFindManyMock,
  personalCategoryFindManyMock,
} = vi.hoisted(() => ({
  personalTransactionFindManyMock: vi.fn(),
  personalTemplateFindManyMock: vi.fn(),
  personalAckFindManyMock: vi.fn(),
  householdMemberFindManyMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
  settlementGroupByMock: vi.fn(),
  transactionGroupByMock: vi.fn(),
  queryRawMock: vi.fn(),
  templateSplitFindManyMock: vi.fn(),
  templateAckFindManyMock: vi.fn(),
  templateFindManyMock: vi.fn(),
  plannedSplitFindManyMock: vi.fn(),
  personalPlannedFindManyMock: vi.fn(),
  personalCategoryFindManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalTransaction: { findMany: personalTransactionFindManyMock },
    personalRecurringTemplate: { findMany: personalTemplateFindManyMock },
    personalRecurringTemplateAck: { findMany: personalAckFindManyMock },
    householdMember: { findMany: householdMemberFindManyMock },
    transaction: { findMany: transactionFindManyMock, groupBy: transactionGroupByMock },
    memberSettlement: { groupBy: settlementGroupByMock },
    $queryRaw: queryRawMock,
    recurringTemplateSplit: { findMany: templateSplitFindManyMock },
    recurringTemplateAck: { findMany: templateAckFindManyMock },
    recurringTemplate: { findMany: templateFindManyMock },
    plannedExpenseSplit: { findMany: plannedSplitFindManyMock },
    personalPlannedExpense: { findMany: personalPlannedFindManyMock },
    personalBudgetCategory: { findMany: personalCategoryFindManyMock },
  },
}));

import { loadPersonalBudgetPosition } from "./personal-budget-position";
import { computeMemberPosition, isSettledBill } from "./settle-up-calc";

// PERF-2: the loader reads each table the narrow way (a date window, an
// aggregate, an unsettled-bills id query), so these tests keep a small
// in-memory copy of the data and answer those queries by actually applying
// the `where` they were given. That makes every test below also a check that
// the narrowed queries still find what the old read-everything loader did.
type AnyRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let fakePersonal: AnyRow[] = [];
let fakeBills: AnyRow[] = [];
let fakeSettlements: AnyRow[] = [];

const inRange = (date: Date, filter?: { gte?: Date; lt?: Date }) =>
  (!filter?.gte || date >= filter.gte) && (!filter?.lt || date < filter.lt);
const hasMember = (bill: AnyRow, ids: string[]) =>
  bill.splits.some((s: AnyRow) => ids.includes(s.householdMemberId));
// Newest first, ties by input order (createdAt isn't set on fixtures).
const newestFirst = (rows: AnyRow[]) => [...rows].sort((a, b) => b.date.getTime() - a.date.getTime());

function setPersonalTransactions(rows: AnyRow[]) {
  fakePersonal = rows;
  personalTransactionFindManyMock.mockImplementation(async ({ where }: AnyRow) =>
    newestFirst(fakePersonal).filter((t) => inRange(t.date, where.date)),
  );
}

function setBills(rows: AnyRow[]) {
  fakeBills = rows;
  transactionFindManyMock.mockImplementation(async ({ where }: AnyRow) => {
    const mine = where.splits?.some?.householdMemberId?.in as string[] | undefined;
    // Unsettled bills, by id (after the raw id query).
    if (where.id?.in) {
      return newestFirst(fakeBills)
        .filter((b) => where.id.in.includes(b.id) && inRange(b.date, where.date))
        .map((b) => ({ amount: b.amount, date: b.date, splits: b.splits }));
    }
    // The latest bill per template: exact (template, date) pairs.
    if (where.OR) {
      return newestFirst(fakeBills).filter(
        (b) =>
          hasMember(b, mine!) &&
          where.OR.some((o: AnyRow) => o.recurringTemplateId === b.recurringTemplateId && o.date.getTime() === b.date.getTime()),
      );
    }
    // The shared templates' own bills, for their period status.
    if (where.recurringTemplateId?.in) {
      return fakeBills.filter(
        (b) => where.recurringTemplateId.in.includes(b.recurringTemplateId) && inRange(b.date, where.date),
      );
    }
    // The viewed period's split bills.
    return newestFirst(fakeBills).filter((b) => hasMember(b, mine!) && inRange(b.date, where.date));
  });
  // The latest date per template among bills split with the user.
  transactionGroupByMock.mockImplementation(async ({ where }: AnyRow) => {
    const mine = where.splits.some.householdMemberId.in as string[];
    const latest = new Map<string, Date>();
    for (const b of fakeBills) {
      const id = b.recurringTemplateId as string | undefined;
      if (!id || where.recurringTemplateId.notIn.includes(id)) continue;
      if (!inRange(b.date, where.date) || !hasMember(b, mine)) continue;
      const seen = latest.get(id);
      if (!seen || b.date > seen) latest.set(id, b.date);
    }
    return [...latest].map(([recurringTemplateId, date]) => ({ recurringTemplateId, _max: { date } }));
  });
  // The ids of bills the user is in that aren't settled (the raw SQL).
  queryRawMock.mockImplementation(async (_strings: unknown, memberIds: string[]) =>
    fakeBills
      .filter((b) => hasMember(b, memberIds) && !isSettledBill({ amount: b.amount, splits: b.splits }))
      .map((b) => ({ id: b.id })),
  );
}

function setSettlements(rows: AnyRow[]) {
  fakeSettlements = rows;
  settlementGroupByMock.mockImplementation(async ({ where }: AnyRow) => {
    const sums = new Map<string, AnyRow>();
    for (const t of fakeSettlements) {
      if (!inRange(t.date, where.date)) continue;
      const key = `${t.fromMemberId}>${t.toMemberId}`;
      const sum = sums.get(key);
      if (sum) sum._sum.amount += t.amount;
      else sums.set(key, { fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, _sum: { amount: t.amount } });
    }
    return [...sums.values()];
  });
}

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
  personalPlannedFindManyMock.mockResolvedValue([]);
  personalCategoryFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPersonalBudgetPosition", () => {
  it("combines own and shared money, carried debts and what's still due", async () => {
    setPersonalTransactions([
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
    setBills([
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
    setSettlements([
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
      stillBudgeted: 0,
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
    setPersonalTransactions([]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    setBills([
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
    setSettlements([]);
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
        where: { id: { in: ["tpl-power", "tpl-rent"] }, householdId: { in: ["h1"] } },
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

  it("judges a shared bill on its household's budget periods (start day 25)", async () => {
    // UX-134: rent logged on 28 Sep belongs to the household's October
    // (25 Sep to 24 Oct). The personal October view must not keep it Due,
    // or "Log payment" on that row would hit the duplicate guard and the
    // user could never clear it.
    const octoberStart = new Date(2026, 9, 1);
    const octoberEnd = new Date(2026, 10, 1);
    const setup = () => {
      setPersonalTransactions([]);
      personalTemplateFindManyMock.mockResolvedValue([]);
      personalAckFindManyMock.mockResolvedValue([]);
      householdMemberFindManyMock.mockResolvedValue([
        { id: "m-me", household: { id: "h1", name: "Home", budgetMonthStartDay: 25 } },
      ]);
      setBills([
        {
          id: "sep-rent",
          amount: 12000,
          type: "EXPENSE",
          date: new Date(2026, 8, 28),
          recurringTemplateId: "tpl-rent",
          category: { name: "Rent" },
          splits: [split("m-me", "Me", 6000, 6000), split("m-p", "Partner", 6000, 6000)],
        },
      ]);
      setSettlements([]);
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
          transactions: [{ id: "sep-rent" }],
        },
      ]);
    };

    setup();
    const early = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: octoberStart,
      monthEnd: octoberEnd,
      now: new Date(2026, 9, 3),
      sharedLabel: "Shared",
    });
    expect(early.sharedDueRows).toEqual([]);

    // From the 25th the household's next period has begun: due again.
    setup();
    const late = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: octoberStart,
      monthEnd: octoberEnd,
      now: new Date(2026, 9, 28),
      sharedLabel: "Shared",
    });
    expect(late.sharedDueRows).toEqual([expect.objectContaining({ id: "tpl-rent" })]);
  });

  it("drops a hand-split bill once a later one is logged without the user", async () => {
    // Rent was split with me in August, but September's was logged unsplit
    // (it never reaches the split-bill query). October must not show it.
    setPersonalTransactions([]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    setBills([
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
    setSettlements([]);
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
    setPersonalTransactions([]);
    personalTemplateFindManyMock.mockResolvedValue([
      personalTemplate("Salary", "INCOME", 30000),
      personalTemplate("Gym", "EXPENSE", 300),
    ]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([
      { id: "m-me", household: { id: "h1", name: "Home" } },
    ]);
    setBills([]);
    setSettlements([]);
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

  it("runs the user's own recurring items on their payday periods (start day 25)", async () => {
    // "October" with day 25 is 25 Sep to 24 Oct, so the gym paid on 3 Oct is
    // October's: posted and counted, not still due. On calendar months the
    // period would start 1 Sep and the gym would still show as due.
    setPersonalTransactions([
      { ...personalTx("Gym", "EXPENSE", 300, 1, "Gym"), date: new Date(2026, 9, 3) },
    ]);
    personalTemplateFindManyMock.mockResolvedValue([personalTemplate("Gym", "EXPENSE", 300)]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: new Date(2026, 8, 25),
      monthEnd: new Date(2026, 9, 25),
      startDay: 25,
      sharedLabel: "Shared",
    });

    expect(position.templateStatusRows).toEqual([
      expect.objectContaining({ template: expect.objectContaining({ id: "Gym" }), status: "posted" }),
    ]);
    expect(position.expense).toBe(300);
    expect(position.safeToSpendBreakdown).toMatchObject({ duePayments: 0 });
  });

  it("works with no household at all", async () => {
    setPersonalTransactions([personalTx("Salary", "INCOME", 1000, 5)]);
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
    setPersonalTransactions([
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

  it("paces the projection and daily allowance over a payday period (start day 25)", async () => {
    // "October" with day 25 is 25 Sep to 24 Oct: 30 days. On 3 Oct, 9 of
    // them have gone and 22 are left, today included. Measured against the
    // calendar month instead, 3 Oct would be outside a period starting
    // 25 Sep and both figures would vanish.
    setPersonalTransactions([
      personalTx("Salary", "INCOME", 3000, 26),
      { ...personalTx("Food", "EXPENSE", 90, 1), date: new Date(2026, 9, 2) },
    ]);
    personalTemplateFindManyMock.mockResolvedValue([]);
    personalAckFindManyMock.mockResolvedValue([]);
    householdMemberFindManyMock.mockResolvedValue([]);
    templateSplitFindManyMock.mockResolvedValue([]);

    const position = await loadPersonalBudgetPosition({
      userId: "user-1",
      monthStart: new Date(2026, 8, 25),
      monthEnd: new Date(2026, 9, 25),
      startDay: 25,
      sharedLabel: "Shared",
      now: new Date(2026, 9, 3, 12),
    });

    expect(position.safeToSpend).toBe(2910);
    expect(position.safeToSpendProjection).toMatchObject({
      daysInMonth: 30,
      daysElapsed: 9,
      dailyPace: 10,
      projected: 2910 - 10 * 21,
    });
    expect(position.safeToSpendDaily).toEqual({ perDay: 2910 / 22, daysLeft: 22 });
  });
  it("holds back what is still unspent of a category's monthly limit (UX-138)", async () => {
    setPersonalTransactions([
      personalTx("Salary", "INCOME", 10000, 1),
      // 1200 of the 3000 food limit spent, so 1800 stays held back.
      { ...personalTx("Food", "EXPENSE", 1200, 2), categoryId: "cat-food" },
    ]);
    personalCategoryFindManyMock.mockResolvedValue([
      { id: "cat-food", type: "EXPENSE", monthlyLimit: 3000, rolloverEnabled: false, createdAt: new Date(2026, 0, 1) },
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

    expect(position.safeToSpendBreakdown.stillBudgeted).toBe(1800);
    expect(position.safeToSpend).toBe(10000 - 1200 - 1800);
    // The food is already reserved, so it isn't everyday pace.
    expect(position.safeToSpendProjection).toBeNull();
  });

  describe("planned bills (BUDGET-8)", () => {
    function setup(plannedSplits: unknown[]) {
      setPersonalTransactions([personalTx("Salary", "INCOME", 30000, 5)]);
      personalTemplateFindManyMock.mockResolvedValue([]);
      personalAckFindManyMock.mockResolvedValue([]);
      householdMemberFindManyMock.mockResolvedValue([{ id: "m1", household: { id: "h1", name: "Home" } }]);
      setBills([]);
      setSettlements([]);
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

  describe("personal planned bills", () => {
    function setup(bills: unknown[]) {
      setPersonalTransactions([personalTx("Salary", "INCOME", 30000, 5)]);
      personalTemplateFindManyMock.mockResolvedValue([]);
      personalAckFindManyMock.mockResolvedValue([]);
      householdMemberFindManyMock.mockResolvedValue([]);
      templateSplitFindManyMock.mockResolvedValue([]);
      personalPlannedFindManyMock.mockResolvedValue(bills);
    }
    const bill = (id: string, dueDate: Date, transaction: { date: Date } | null = null) => ({
      id,
      name: id,
      amount: 1200,
      categoryId: "cat-health",
      category: { name: "Health" },
      dueDate,
      transaction,
    });
    const load = () =>
      loadPersonalBudgetPosition({ userId: "user-1", monthStart, monthEnd, sharedLabel: "Shared" });

    it("subtracts due and overdue bills at their full amount, not upcoming ones", async () => {
      setup([
        bill("Dentist", new Date(2026, 8, 20, 12)),
        bill("Glasses", new Date(2026, 7, 10, 12)),
        bill("Course", new Date(2026, 9, 5, 12)),
      ]);

      const position = await load();

      expect(position.plannedExpenses.map((p) => [p.id, p.status])).toEqual([
        ["Dentist", "due"],
        ["Glasses", "overdue"],
        ["Course", "upcoming"],
      ]);
      expect(position.safeToSpendBreakdown.duePayments).toBe(2400);
      expect(position.safeToSpend).toBe(30000 - 2400);
      expect(position.expectedRecurring).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ categoryId: "Dentist", amount: 1200, source: "personal" }),
        ]),
      );
    });

    it("adds planned income as expected income only in the month it's due", async () => {
      setup([
        { ...bill("Tax refund", new Date(2026, 8, 20, 12)), category: { name: "Salary", type: "INCOME" } },
        { ...bill("Bonus", new Date(2026, 7, 20, 12)), category: { name: "Salary", type: "INCOME" } },
      ]);

      const position = await load();

      expect(position.plannedExpenses.map((p) => [p.id, p.type, p.status])).toEqual([
        ["Tax refund", "INCOME", "due"],
        ["Bonus", "INCOME", "overdue"],
      ]);
      expect(position.safeToSpendBreakdown.dueIncome).toBe(1200);
      expect(position.safeToSpendBreakdown.duePayments).toBe(0);
      expect(position.safeToSpend).toBe(30000 + 1200);
    });

    it("counts a paid bill only through its transaction", async () => {
      setup([bill("Dentist", new Date(2026, 8, 20, 12), { date: new Date(2026, 8, 21) })]);

      const position = await load();

      expect(position.plannedExpenses[0]).toEqual(
        expect.objectContaining({ status: "paid", paidAt: new Date(2026, 8, 21) }),
      );
      expect(position.safeToSpendBreakdown.duePayments).toBe(0);
    });

    it("only reads the user's own bills that aren't settled history", async () => {
      setup([]);

      await load();

      expect(personalPlannedFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: "user-1",
            OR: [
              { transaction: { is: null } },
              { transaction: { is: { date: { gte: monthStart } } } },
            ],
          },
        }),
      );
    });
  });
  // PERF-2: the loader reads a window and aggregates instead of the whole
  // history. These pin down that the narrower reads give the numbers the full
  // history would.
  describe("reads a window, not the whole history (PERF-2)", () => {
    const octoberStart = new Date(2026, 9, 1);
    const octoberEnd = new Date(2026, 10, 1);

    function datedTx(
      id: string,
      categoryId: string,
      type: "INCOME" | "EXPENSE" | "SAVINGS",
      amount: number,
      date: Date,
      isRecurring = false,
    ) {
      return { id, categoryId, category: { name: categoryId }, type, amount, date, isRecurring, recurringTemplateId: null };
    }

    function quietDefaults(withHousehold: boolean) {
      personalTemplateFindManyMock.mockResolvedValue([]);
      personalAckFindManyMock.mockResolvedValue([]);
      householdMemberFindManyMock.mockResolvedValue(
        withHousehold ? [{ id: "m-me", household: { id: "h1", name: "Home" } }] : [],
      );
      templateSplitFindManyMock.mockResolvedValue([]);
      templateAckFindManyMock.mockResolvedValue([]);
      templateFindManyMock.mockResolvedValue([]);
    }

    const load = () =>
      loadPersonalBudgetPosition({
        userId: "user-1",
        monthStart: octoberStart,
        monthEnd: octoberEnd,
        sharedLabel: "Shared",
        now: new Date(2026, 9, 10, 12),
      });

    it("asks the database for the viewed month and a 12-month window, never the whole history", async () => {
      setPersonalTransactions([datedTx("Salary", "pc-salary", "INCOME", 100, new Date(2026, 9, 5))]);
      quietDefaults(false);

      await load();

      const wheres = personalTransactionFindManyMock.mock.calls.map(([args]) => args.where);
      expect(wheres).toEqual([
        { userId: "user-1", date: { gte: octoberStart, lt: octoberEnd } },
        // 12 months back, to the end of the year the month starts in (a
        // YEARLY template is posted by a bill anywhere in its year).
        { userId: "user-1", date: { gte: new Date(2025, 9, 1), lt: new Date(2027, 0, 1) } },
      ]);
    });

    it("gives the same numbers whether or not years of older history exist", async () => {
      const recent = [
        datedTx("Salary", "pc-salary", "INCOME", 30000, new Date(2026, 9, 5)),
        datedTx("Food", "pc-food", "EXPENSE", 2000, new Date(2026, 9, 6)),
        datedTx("Buffer", "pc-buffer", "SAVINGS", 1500, new Date(2026, 9, 7)),
        // Feeds the "not yet logged" estimate: a recurring bill in September
        // and none yet in October.
        datedTx("Phone", "pc-phone", "EXPENSE", 400, new Date(2026, 8, 3), true),
        // Rollover: food is capped at 3000/month and only 1000 was spent in
        // August.
        datedTx("Food-aug", "pc-food", "EXPENSE", 1000, new Date(2026, 7, 9)),
      ];
      // Two and a half more years behind it (to June 2025), all before the window.
      const old = Array.from({ length: 30 }, (_, i) => [
        datedTx(`old-in-${i}`, "pc-salary", "INCOME", 30000, new Date(2023, i, 5)),
        datedTx(`old-food-${i}`, "pc-food", "EXPENSE", 5000, new Date(2023, i, 6)),
        datedTx(`old-phone-${i}`, "pc-phone", "EXPENSE", 999, new Date(2023, i, 3), true),
      ]).flat();
      personalCategoryFindManyMock.mockResolvedValue([
        {
          id: "pc-food",
          type: "EXPENSE",
          monthlyLimit: 3000,
          rolloverEnabled: true,
          createdAt: new Date(2020, 0, 1),
        },
      ]);
      quietDefaults(false);

      setPersonalTransactions(recent);
      const withoutHistory = await load();
      setPersonalTransactions([...recent, ...old]);
      const withHistory = await load();

      const { lookbackTransactions: a, ...restWithout } = withoutHistory;
      const { lookbackTransactions: b, ...restWith } = withHistory;
      expect(restWith).toEqual(restWithout);
      // The old rows never reached the calcs.
      expect(b).toEqual(a);
      // Sanity: the estimate and the held-back envelope are really in play.
      expect(restWith.expectedRecurring.map((e) => e.categoryName)).toContain("pc-phone");
      expect(restWith.safeToSpendBreakdown.stillBudgeted).toBeGreaterThan(0);
    });

    it("counts a YEARLY shared bill logged later in the viewed year as posted", async () => {
      setPersonalTransactions([]);
      quietDefaults(true);
      templateSplitFindManyMock.mockResolvedValue([
        {
          householdMemberId: "m-me",
          recurringTemplateId: "tpl-insurance",
          amountOwed: 500,
          recurringTemplate: {
            id: "tpl-insurance",
            householdId: "h1",
            categoryId: "cat-ins",
            category: { name: "Insurance" },
            name: "Insurance",
            amount: 1000,
            type: "EXPENSE",
            frequency: "YEARLY",
            active: true,
            createdAt: new Date(2020, 0, 1),
            splits: [
              { householdMemberId: "m-me", amountOwed: 500 },
              { householdMemberId: "m-p", amountOwed: 500 },
            ],
          },
        },
      ]);
      setSettlements([]);
      // Paid in December, after the viewed October, in the same calendar year.
      setBills([
        {
          id: "ins-dec",
          amount: 1000,
          type: "EXPENSE",
          date: new Date(2026, 11, 20),
          recurringTemplateId: "tpl-insurance",
          category: { name: "Insurance" },
          splits: [split("m-me", "Me", 500, 500), split("m-p", "Partner", 500, 500)],
        },
      ]);

      const position = await load();

      expect(position.sharedDueRows).toEqual([]);
    });

    describe("shared debts", () => {
      // Years of settled bills, one old bill still open and an old repayment:
      // owedFromEarlier must equal what the full history gives.
      const bills = [
        ...Array.from({ length: 60 }, (_, i) => ({
          id: `settled-${i}`,
          amount: 1000,
          type: "EXPENSE",
          date: new Date(2022, 0, 1 + i * 20),
          category: { name: "Groceries" },
          splits: [split("m-me", "Me", 500, 500), split("m-p", "Partner", 500, 500)],
        })),
        // Partner paid all of an old bill: I owe 700.
        {
          id: "open-old",
          amount: 1400,
          type: "EXPENSE",
          date: new Date(2023, 4, 2),
          category: { name: "Dinner" },
          splits: [split("m-me", "Me", 700, 0), split("m-p", "Partner", 700, 1400)],
        },
        // Neither has paid this one yet: my share is owed to the bill.
        {
          id: "unpaid-sep",
          amount: 600,
          type: "EXPENSE",
          date: new Date(2026, 8, 15),
          category: { name: "Internet" },
          splits: [split("m-me", "Me", 300, 0), split("m-p", "Partner", 300, 0)],
        },
        // After the viewed month: must not count.
        {
          id: "future",
          amount: 800,
          type: "EXPENSE",
          date: new Date(2026, 10, 3),
          category: { name: "Future" },
          splits: [split("m-me", "Me", 400, 0), split("m-p", "Partner", 400, 800)],
        },
      ];
      const repayments = [
        { fromMemberId: "m-me", toMemberId: "m-p", amount: 200, date: new Date(2023, 6, 1) },
        { fromMemberId: "m-me", toMemberId: "m-p", amount: 100, date: new Date(2026, 8, 20) },
        { fromMemberId: "m-me", toMemberId: "m-p", amount: 999, date: new Date(2026, 10, 9) },
      ];

      it("matches the position computed over every bill and repayment", async () => {
        setPersonalTransactions([]);
        quietDefaults(true);
        setBills(bills);
        setSettlements(repayments);

        const position = await load();

        const dated = bills.map((b) => ({ amount: b.amount, date: b.date, splits: b.splits }));
        const atStart = computeMemberPosition({ memberId: "m-me", transactions: dated, transfers: repayments, asOf: octoberStart });
        const atEnd = computeMemberPosition({ memberId: "m-me", transactions: dated, transfers: repayments, asOf: octoberEnd });
        // 700 - 200 - 100 owed to Partner, plus my 300 of the unpaid bill.
        expect(atStart).toEqual({ memberBalance: -400, owedToBills: 300 });
        expect(position.safeToSpendBreakdown.owedFromEarlier).toBe(
          Math.max(0, -atStart.memberBalance) + atStart.owedToBills,
        );
        expect(position.householdDebts).toEqual([
          { householdId: "h1", householdName: "Home", owedToMembers: -atEnd.memberBalance, owedToBills: atEnd.owedToBills },
        ]);
      });

      it("loads only the bills that are still open, and repayments as sums", async () => {
        setPersonalTransactions([]);
        quietDefaults(true);
        setBills(bills);
        setSettlements(repayments);

        await load();

        // Only the open bills are fetched in full, never the 60 settled ones.
        const openFetch = transactionFindManyMock.mock.calls
          .map(([args]) => args.where)
          .find((where) => where.id);
        expect(openFetch.id.in.sort()).toEqual(["future", "open-old", "unpaid-sep"]);
        expect(openFetch.date).toEqual({ lt: octoberEnd });
        // One grouped repayment query per cut-off, scoped to the user's members.
        expect(settlementGroupByMock.mock.calls.map(([args]) => args.where.date)).toEqual([
          { lt: octoberStart },
          { lt: octoberEnd },
        ]);
        expect(settlementGroupByMock.mock.calls[0][0].where.OR).toEqual([
          { fromMemberId: { in: ["m-me"] } },
          { toMemberId: { in: ["m-me"] } },
        ]);
      });

      it("finds a template's latest hand-split bill however old it is", async () => {
        setPersonalTransactions([]);
        quietDefaults(true);
        setSettlements([]);
        setBills([
          {
            id: "rent-2023",
            amount: 12000,
            type: "EXPENSE",
            date: new Date(2023, 2, 1),
            recurringTemplateId: "tpl-rent",
            category: { name: "Rent" },
            splits: [split("m-me", "Me", 6000, 6000), split("m-p", "Partner", 6000, 6000)],
          },
        ]);
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
            createdAt: new Date(2023, 0, 1),
            transactions: [{ id: "rent-2023" }],
          },
        ]);

        const position = await load();

        expect(position.sharedDueRows).toEqual([expect.objectContaining({ id: "tpl-rent", amount: 6000 })]);
        expect(transactionGroupByMock).toHaveBeenCalledWith(
          expect.objectContaining({ by: ["recurringTemplateId"], _max: { date: true } }),
        );
      });
    });
  });
});
