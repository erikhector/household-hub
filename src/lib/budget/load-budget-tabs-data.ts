import { prisma } from "@/lib/prisma";
import { RECENT_CATEGORY_SAMPLE } from "@/lib/recent-categories";

// MAINT-10: the query batch behind the household Budget page's tabs, moved out
// of dashboard/budget/page.tsx (BudgetTabsSection) so the page keeps its
// derivations and rendering and this file owns what is read and over which
// window. It returns the rows exactly as Prisma gave them; every calculation
// (totals, safe to spend, balances, templates) still happens in the page.

// How many recorded repayments the Balances card lists (newest first) — enough
// to spot and undo a recent mistake without the card growing forever.
const MAX_REPAYMENTS_SHOWN = 10;

// PERF-12: the split bills the Balances card and "left due" list can still
// need — every bill that isn't settled. One grouped query finds their ids,
// then a plain findMany loads them (with the fields the settle-up calc
// needs) newest first, so the work scales with bills still open rather than
// with every bill the household ever split. The HAVING clause is the exact
// negation of isSettledBill (src/lib/settle-up-calc.ts), which is unit-tested
// to prove leaving settled bills out can't change a balance: some member's
// payment differs from their share, or the bill's amount isn't covered by the
// payments by more than the calc's 0.005 EPSILON. Scoped by the household id
// from the session, bound as a parameter.
export async function loadUnsettledSplitBills(householdId: string) {
  const unsettled = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id"
    FROM "Transaction" t
    JOIN "TransactionSplit" s ON s."transactionId" = t."id"
    WHERE t."householdId" = ${householdId}
    GROUP BY t."id", t."amount"
    HAVING bool_or(s."amountPaid" <> s."amountOwed")
        OR t."amount" - sum(s."amountPaid") > 0.005
  `;
  if (unsettled.length === 0) return [];
  return prisma.transaction.findMany({
    where: { householdId, id: { in: unsettled.map((row) => row.id) } },
    select: {
      id: true,
      amount: true,
      date: true,
      description: true,
      category: { select: { name: true } },
      splits: { select: { householdMemberId: true, amountOwed: true, amountPaid: true } },
    },
    orderBy: { date: "desc" },
  });
}

export type BudgetTabsDataInput = {
  // From requireHousehold() (or the read-only view's resolved household),
  // never from the client.
  householdId: string;
  // [monthStart, monthEnd): the viewed budget period.
  monthStart: Date;
  monthEnd: Date;
  // Start of the wider trailing window (RECURRING_LOOKBACK_MONTHS in the
  // page) behind the viewed month.
  recurringLookbackStart: Date;
  // Window for the "Fixed income & costs" trend, anchored to today.
  trendWindowStart: Date;
  trendWindowEnd: Date;
};

export async function loadBudgetTabsData({
  householdId,
  monthStart,
  monthEnd,
  recurringLookbackStart,
  trendWindowStart,
  trendWindowEnd,
}: BudgetTabsDataInput) {
  const [
    categories,
    monthTransactions,
    recurringLookbackTransactions,
    fixedTrendTransactions,
    householdMembers,
    recurringTemplates,
    recurringTemplateAcks,
    splitTransactions,
    memberSettlements,
    memberSettlementSums,
    savingsTotals,
    plannedExpenses,
    latestTransactions,
  ] = await Promise.all([
      prisma.budgetCategory.findMany({
        where: { householdId },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      // SCALE-F: the transactions for the month currently being viewed —
      // feeds the transaction list and the period summary's per-category
      // totals (the settle-up balances read splitTransactions instead, since
      // debts carry over between months). Previously this query had
      // no date filter at all (fetched the household's *entire* transaction
      // history) and the month was filtered down in JS afterward; that grew
      // every month a household kept using the app, independent of how many
      // transactions actually belong to the month being looked at.
      prisma.transaction.findMany({
        where: { householdId, date: { gte: monthStart, lt: monthEnd } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: { category: true, splits: true },
      }),
      // A wider trailing window behind monthTransactions, for the two calcs
      // that need to see more than just the viewed month — see
      // RECURRING_LOOKBACK_MONTHS's doc comment above. Narrowed with
      // `select` (rather than `include`) since neither calc needs splits or
      // a full category row, just the category's name.
      prisma.transaction.findMany({
        where: { householdId, date: { gte: recurringLookbackStart, lt: monthEnd } },
        select: {
          categoryId: true,
          category: { select: { name: true } },
          type: true,
          amount: true,
          date: true,
          isRecurring: true,
          recurringTemplateId: true,
        },
        orderBy: { date: "asc" },
      }),
      // The "Fixed income & costs" trend chart (computeRecurringMonthlyTotals
      // below) always shows the same trailing MAX_FIXED_TREND_MONTHS months
      // ending at *today's* month, independent of whichever month is being
      // browsed above via monthStart/monthEnd — so it gets its own window
      // anchored to `now` instead. Filtered to template-linked transactions
      // only, since that calc ignores every transaction without a
      // recurringTemplateId anyway.
      prisma.transaction.findMany({
        where: {
          householdId,
          recurringTemplateId: { not: null },
          date: { gte: trendWindowStart, lt: trendWindowEnd },
        },
        select: { type: true, amount: true, date: true, recurringTemplateId: true },
      }),
      // Fetched for the expense-splitting feature (see REQUIREMENTS.md's
      // "Household expense splitting" subsection) — the split UI and the
      // balances tab are both only offered when a household has more than
      // one member.
      prisma.householdMember.findMany({
        where: { householdId },
        // swishNumber: GAP-7's "Pay with Swish" link — filtered down to just
        // the payees the signed-in member owes (swishNumbersForPayer) before
        // anything reaches the client.
        include: { user: { select: { displayName: true, swishNumber: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Recurring bill templates — see src/lib/recurring-template-calc.ts and the
      // "Recurring" tab below. `splits` feeds the opt-in template-splitting UI
      // (RecurringTemplateDialog) and the personal budget's "shared with your
      // household" surface — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md.
      prisma.recurringTemplate.findMany({
        where: { householdId },
        include: { category: true, splits: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.recurringTemplateAck.findMany({
        where: { recurringTemplate: { householdId } },
      }),
      // Every split bill that can still matter, for the Balances card and
      // the "left due" list: debts carry over between months until a
      // repayment clears them, so this can't be limited to the viewed month
      // the way monthTransactions is. PERF-12: but a bill that is fully
      // settled (see isSettledBill) contributes nothing to either, so only
      // the others are loaded, however many bills the household has ever
      // split. See loadUnsettledSplitBills.
      loadUnsettledSplitBills(householdId),
      // PERF-12: only the newest few repayments are listed; the balances
      // need every one but only as a sum per (payer, receiver) pair, so that
      // comes from a groupBy (≤ members² rows) instead of every row.
      prisma.memberSettlement.findMany({
        where: { householdId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: MAX_REPAYMENTS_SHOWN,
      }),
      prisma.memberSettlement.groupBy({
        by: ["fromMemberId", "toMemberId"],
        where: { householdId },
        _sum: { amount: true },
      }),
      // GAP-22: each category's all-time savings, for the Savings goals
      // card. A goal is a running total towards a destination, so unlike
      // monthTransactions this ignores the viewed month entirely — and is
      // summed in the database, so it stays one row per category however
      // long a household keeps saving.
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { householdId, type: "SAVINGS" },
        _sum: { amount: true },
      }),
      // Planned bills (BUDGET-8): every unpaid one, plus those paid on or
      // after the viewed month's start. A bill paid before it is history and
      // left out, so this doesn't grow with every bill ever paid. Status is
      // worked out per viewed month below (getPlannedExpenseStatus).
      prisma.plannedExpense.findMany({
        where: {
          householdId,
          OR: [
            { transaction: { is: null } },
            { transaction: { is: { date: { gte: monthStart } } } },
          ],
        },
        include: { category: true, splits: true, transaction: { select: { date: true } } },
        orderBy: { dueDate: "asc" },
      }),
      // UX-109: what was logged last, whatever month is on screen, so the
      // Add transaction sheet can lead with those categories. By when it was
      // logged, not the transaction's date: backdating a bill is still
      // "the category I just used".
      prisma.transaction.findMany({
        where: { householdId },
        orderBy: { createdAt: "desc" },
        take: RECENT_CATEGORY_SAMPLE,
        select: { categoryId: true },
      }),
    ]);

  return {
    categories,
    monthTransactions,
    recurringLookbackTransactions,
    fixedTrendTransactions,
    householdMembers,
    recurringTemplates,
    recurringTemplateAcks,
    splitTransactions,
    memberSettlements,
    memberSettlementSums,
    savingsTotals,
    plannedExpenses,
    latestTransactions,
  };
}
