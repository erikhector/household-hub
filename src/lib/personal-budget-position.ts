// Everything Personal Budget's "Remaining after expenses and savings" number
// needs, loaded and computed in one place so the dashboard's "Your budget"
// card shows exactly the same number as /dashboard/personal-budget instead of
// a second, drifting copy of the math. Before this module the dashboard ran
// its own simplified version that ignored shared household bills and debts
// entirely — see REQUIREMENTS.md's "Safe to spend" subsection.
//
// The headline is
//
//   income − expenses − savings − owed from earlier months
//          − due payments − due savings
//
// where, for the user's share of a split household bill (see
// src/lib/settle-up-calc.ts):
// - The user's *share* counts as spent in the bill's month, no matter who
//   actually paid it. Paying more than your share doesn't make you poorer,
//   since the others owe it back, and paying less doesn't make you richer,
//   since you still owe the rest. Paying a member back later therefore
//   doesn't change the number a second time.
// - A debt still open when a month starts (to other members, net of what
//   they owe you, plus your unpaid share of older bills) is subtracted again
//   in that month as "owed from earlier months". Debts carry over until
//   they're cleared, rather than silently resetting each month. Money
//   others owe you from earlier months is *not* added back, since it isn't
//   yours to spend until they actually pay.

import { prisma } from "@/lib/prisma";
import type { CategoryTotal } from "@/components/budget/category-breakdown";
import type { SharedPostedRow } from "@/components/budget/transaction-list";
import type { SharedDueRow } from "@/components/budget/due-recurring-widget";
import { computeTemplateStatuses } from "@/lib/recurring-template-calc";
import { normalizeStartDay } from "@/lib/budget-date-utils";
import {
  computeSafeToSpend,
  computeStillBudgeted,
  deriveSafeToSpend,
  type ExpectedRecurringExpense,
  type HouseholdDebt,
  type SafeToSpendBreakdown,
  type SafeToSpendStatus,
} from "@/lib/safe-to-spend-calc";
import {
  getPlannedExpenseStatus,
  isPlannedExpenseOutstanding,
  plannedItemType,
} from "@/lib/planned-expense-calc";
import { categoryEnvelopes } from "@/lib/budget-category-limit";
import { dailyAllowance, projectMonthEnd } from "@/lib/chart-calc";
import {
  computeMemberPosition,
  remainingDue,
  type DatedMemberTransfer,
  type DatedSplitTransaction,
} from "@/lib/settle-up-calc";

// PERF-2: how far behind the viewed period the user's own transactions are
// read. Same trade-off as the household budget's RECURRING_LOOKBACK_MONTHS
// (src/app/dashboard/budget/page.tsx, SCALE-F): the "not yet logged" estimate
// looks for a category's latest recurring expense dated before the period,
// the YEARLY template status needs its calendar year, GAP-21's category
// rollover reaches back to January of the viewed year (at most 11 months,
// src/lib/budget-rollover-calc.ts) and the sparkline history 6 months. 12
// months covers all of them, so the loader no longer reads every
// transaction the user ever logged.
const LOOKBACK_MONTHS = 12;

// The split bills that can still move the user's balance: every bill with a
// share for one of `memberIds` that isn't settled. A settled bill (everyone
// paid exactly their share and nothing is left on it) gets an all-zero
// position from computeBillPositions, so leaving it out cannot change
// "owed from earlier months" or the debts line; see isSettledBill in
// src/lib/settle-up-calc.ts, which the HAVING clause negates exactly (the
// household Budget page's loadUnsettledSplitBills does the same, PERF-12).
// One grouped query finds the ids, so the work scales with the bills still
// open rather than with every bill the user ever shared. The member ids come
// from the user's own memberships (never the client) and are bound as one
// array parameter.
async function loadUnsettledSplitBills(memberIds: string[], monthEnd: Date) {
  const unsettled = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t."id"
    FROM "Transaction" t
    JOIN "TransactionSplit" s ON s."transactionId" = t."id"
    WHERE EXISTS (
      SELECT 1 FROM "TransactionSplit" mine
      WHERE mine."transactionId" = t."id" AND mine."householdMemberId" = ANY(${memberIds}::text[])
    )
    GROUP BY t."id", t."amount"
    HAVING bool_or(s."amountPaid" <> s."amountOwed")
        OR t."amount" - sum(s."amountPaid") > 0.005
  `;
  if (unsettled.length === 0) return [];
  // The viewed period's end is applied here, as a plain Prisma filter, so no
  // JS Date is ever bound into the raw SQL's timestamp comparison.
  return prisma.transaction.findMany({
    where: { id: { in: unsettled.map((row) => row.id) }, date: { lt: monthEnd } },
    select: {
      amount: true,
      date: true,
      splits: { select: { householdMemberId: true, amountOwed: true, amountPaid: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
}

// Repayments between members dated before `before`, summed per (payer,
// receiver) pair in the database: computeMemberPosition only adds each one to
// the payer and subtracts it from the receiver, so one summed transfer per
// pair gives the same balance as one per row (sumTransfersByPair in
// settle-up-calc.ts, PERF-12). Bounded by members², however many repayments
// were logged. Dated at the epoch so the calc's own `date >= asOf` skip never
// fires: the WHERE clause has already applied it.
async function loadSettlementSums(memberIds: string[], before: Date): Promise<DatedMemberTransfer[]> {
  const sums = await prisma.memberSettlement.groupBy({
    by: ["fromMemberId", "toMemberId"],
    where: {
      date: { lt: before },
      OR: [{ fromMemberId: { in: memberIds } }, { toMemberId: { in: memberIds } }],
    },
    _sum: { amount: true },
  });
  return sums.map((s) => ({
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amount: s._sum.amount ?? 0,
    date: new Date(0),
  }));
}

export async function loadPersonalBudgetPosition({
  userId,
  monthStart,
  monthEnd,
  sharedLabel,
  now = new Date(),
  startDay = 1,
}: {
  userId: string;
  /** `[monthStart, monthEnd)` is the viewed period: a calendar month, or
   * with `startDay` above 1 the user's payday period (periodBounds). */
  monthStart: Date;
  monthEnd: Date;
  /** The user's Personal Budget month start day
   * (User.personalBudgetMonthStartDay): the periods their own recurring
   * items, category limits and the projection run on. Defaults to 1, the
   * calendar month. Shared household bills keep their own household's. */
  startDay?: number;
  /** "Today", for the projected end-of-month line (UX-39). */
  now?: Date;
  /** dict.personalBudget.shared.sharedBadge — appended to a shared
   * category's name in the per-category totals, so a personal "Rent" and a
   * shared "Rent" don't merge into one row. */
  sharedLabel: string;
}) {
  // PERF-2: the viewed period's rows for the list and totals, plus a trailing
  // window behind them for the calcs that need to see further than the
  // period — see LOOKBACK_MONTHS. The window ends at the later of the
  // period's end and the end of the calendar year the period starts in,
  // since a YEARLY template counts as posted by a bill logged anywhere in
  // that year (getPeriodKey); nothing else reads a row dated after the
  // period. A calendar-month floor can only reach further back than a
  // payday period's start would.
  const lookbackStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - LOOKBACK_MONTHS, 1);
  const yearEnd = new Date(monthStart.getFullYear() + 1, 0, 1);
  const lookbackEnd = yearEnd > monthEnd ? yearEnd : monthEnd;
  const [monthTransactions, lookbackTransactions, recurringTemplates, recurringTemplateAcks, memberships, ownPlannedExpenses, limitedCategories] = await Promise.all([
    prisma.personalTransaction.findMany({
      where: { userId, date: { gte: monthStart, lt: monthEnd } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { category: true },
    }),
    // Narrowed with `select`: the calcs need no description or full category
    // row. Same order as the list, since computeSafeToSpend breaks a
    // same-day tie by the first row it meets.
    prisma.personalTransaction.findMany({
      where: { userId, date: { gte: lookbackStart, lt: lookbackEnd } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        categoryId: true,
        category: { select: { name: true } },
        type: true,
        amount: true,
        date: true,
        isRecurring: true,
        recurringTemplateId: true,
      },
    }),
    // Recurring bill templates — mirrors the household budget's, see
    // src/lib/recurring-template-calc.ts.
    prisma.personalRecurringTemplate.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.personalRecurringTemplateAck.findMany({
      where: { personalRecurringTemplate: { userId } },
    }),
    prisma.householdMember.findMany({
      where: { userId },
      select: { id: true, household: { select: { id: true, name: true, budgetMonthStartDay: true } } },
    }),
    // The user's own planned bills (PersonalPlannedExpense): every unpaid
    // one, plus those paid on or after the viewed month's start — the same
    // filter as the household Budget page's, so it doesn't grow with every
    // bill ever paid. Upcoming ones are included because the Manage tab
    // lists them; only due and overdue ones count below.
    prisma.personalPlannedExpense.findMany({
      where: {
        userId,
        OR: [{ transaction: { is: null } }, { transaction: { is: { date: { gte: monthStart } } } }],
      },
      include: { category: { select: { name: true, type: true } }, transaction: { select: { date: true } } },
      orderBy: { dueDate: "asc" },
    }),
    // UX-138: the limited categories, whose unspent remainder is held back.
    prisma.personalBudgetCategory.findMany({
      where: { userId, type: "EXPENSE", monthlyLimit: { not: null } },
      select: { id: true, type: true, monthlyLimit: true, rolloverEnabled: true, createdAt: true },
    }),
  ]);

  // Status per viewed month — see src/lib/planned-expense-calc.ts.
  const plannedExpenses = ownPlannedExpenses.map((p) => {
    const paidAt = p.transaction?.date ?? null;
    return {
      id: p.id,
      name: p.name,
      amount: p.amount,
      dueDate: p.dueDate,
      categoryId: p.categoryId,
      categoryName: p.category.name,
      type: plannedItemType(p.category.type),
      status: getPlannedExpenseStatus({ dueDate: p.dueDate, paidAt }, monthStart, monthEnd),
      paidAt,
    };
  });

  // --- Shared with your household -------------------------------------------
  // See docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md: a read-only mirror of
  // the user's own share of split household costs, aggregated across every
  // household they belong to (not just the "active" one — a user's rent
  // share shouldn't disappear from their personal budget just because a
  // different household is selected elsewhere in the app). Never a full
  // transaction/template amount, always this user's own `amountOwed` share.
  const householdMemberIds = memberships.map((m) => m.id);
  const householdByMemberId = new Map(memberships.map((m) => [m.id, m.household]));
  // Only shown on each row once the user is in more than one household —
  // see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6 ("don't clutter the
  // common case").
  const showHouseholdName = memberships.length > 1;

  // PERF-2: what the shared section needs, each piece read the narrow way
  // instead of loading every split bill the user was ever part of:
  // - this period's bills with a split row for the user, with every member's
  //   row (how much the user owes the bill vs. the other members depends on
  //   what everyone paid) and names, for the posted rows below;
  // - the bills before the end of the period that aren't settled yet, which
  //   are all that "owed from earlier months" and the debts line are made of
  //   (loadUnsettledSplitBills);
  // - repayments summed per pair, before the period's start and its end
  //   (loadSettlementSums);
  // - the shared templates' explicit splits, for 3b.
  const [monthSharedTransactions, unsettledBills, settlementsAtStart, settlementsAtEnd, sharedTemplateSplits] =
    householdMemberIds.length > 0
      ? await Promise.all([
          prisma.transaction.findMany({
            where: {
              date: { gte: monthStart, lt: monthEnd },
              splits: { some: { householdMemberId: { in: householdMemberIds } } },
            },
            include: {
              category: { select: { name: true } },
              splits: { include: { householdMember: { include: { user: { select: { displayName: true } } } } } },
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          }),
          loadUnsettledSplitBills(householdMemberIds, monthEnd),
          loadSettlementSums(householdMemberIds, monthStart),
          loadSettlementSums(householdMemberIds, monthEnd),
          // Shared RecurringTemplates the user has a split row in — see 3b.
          prisma.recurringTemplateSplit.findMany({
            where: { householdMemberId: { in: householdMemberIds } },
            include: {
              recurringTemplate: {
                include: {
                  category: { select: { name: true } },
                  // Every member's share, not just this user's — "Log payment"
                  // pre-fills the whole bill's split from these.
                  splits: true,
                },
              },
            },
          }),
        ])
      : [[], [], [], [], []];

  const myMemberIdIn = (tx: { splits: { householdMemberId: string }[] }) =>
    tx.splits.find((s) => householdMemberIds.includes(s.householdMemberId))?.householdMemberId;

  // 3a: already-posted split transactions this month.
  const sharedPostedRows: SharedPostedRow[] = [];
  for (const tx of monthSharedTransactions) {
    const memberId = myMemberIdIn(tx);
    if (!memberId) continue;
    const mySplit = tx.splits.find((s) => s.householdMemberId === memberId)!;
    // A payer-only row (amountOwed 0, see TransactionSplit's doc comment)
    // isn't a cost for this user, so it doesn't belong in their budget.
    if (mySplit.amountOwed <= 0) continue;
    const household = householdByMemberId.get(memberId);
    const splits = tx.splits.map((s) => ({
      householdMemberId: s.householdMemberId,
      amountOwed: s.amountOwed,
      amountPaid: s.amountPaid,
    }));
    sharedPostedRows.push({
      id: mySplit.id,
      categoryName: tx.category.name,
      amount: mySplit.amountOwed,
      type: tx.type,
      date: tx.date,
      householdId: household?.id ?? "",
      householdName: household?.name ?? "",
      paidByNames: tx.splits
        .filter((s) => s.amountPaid > 0)
        .map((s) => s.householdMember.user.displayName),
      yourPaid: mySplit.amountPaid,
      leftDue: remainingDue({ amount: tx.amount, splits }),
    });
  }

  // Debts: per household, what was still owed when the month started (feeds
  // the headline) and where things stand at the end of it (shown below it).
  const datedTransactions: DatedSplitTransaction[] = unsettledBills.map((tx) => ({
    amount: tx.amount,
    date: tx.date,
    splits: tx.splits,
  }));
  let owedFromEarlier = 0;
  const householdDebts: HouseholdDebt[] = [];
  for (const m of memberships) {
    const atStart = computeMemberPosition({
      memberId: m.id,
      transactions: datedTransactions,
      transfers: settlementsAtStart,
      asOf: monthStart,
    });
    owedFromEarlier += Math.max(0, -atStart.memberBalance) + atStart.owedToBills;
    const atEnd = computeMemberPosition({
      memberId: m.id,
      transactions: datedTransactions,
      transfers: settlementsAtEnd,
      asOf: monthEnd,
    });
    if (atEnd.memberBalance !== 0 || atEnd.owedToBills !== 0) {
      householdDebts.push({
        householdId: m.household.id,
        householdName: m.household.name,
        owedToMembers: -atEnd.memberBalance,
        owedToBills: atEnd.owedToBills,
      });
    }
  }

  // 3b: due-but-not-yet-posted shared RecurringTemplates — the literal "Rent
  // pops up" case. A template counts as shared with the user when either
  // - it has an explicit split (RecurringTemplateSplit) with a row for them, or
  // - it has none, but the latest bill logged from it was split with them.
  //   Splitting the bill by hand each month (TransactionDialog's "Split this
  //   expense") never writes a template split, so before this fallback such
  //   a bill showed in every month it had been logged and vanished from every
  //   month it hadn't yet — flip to next month and the household's shared
  //   rent was gone from the personal budget. The latest split is the best
  //   guess of how the next one will be divided, the same way "Log payment"
  //   pre-fills a split from the template's.
  // A template that has never been split with the user stays invisible (no
  // retroactive backfill).
  const explicitTemplateIds = new Set(sharedTemplateSplits.map((s) => s.recurringTemplateId));
  // The latest bill per template that was split with the user (up to the end
  // of the viewed month), for the templates with no explicit split. PERF-2:
  // found in two steps instead of walking every bill the user ever shared —
  // each template's latest date in one grouped query, then just the bills on
  // those dates, newest first so a same-day tie is broken by createdAt like
  // the full list was.
  const latestBillDates =
    householdMemberIds.length > 0
      ? await prisma.transaction.groupBy({
          by: ["recurringTemplateId"],
          where: {
            date: { lt: monthEnd },
            recurringTemplateId: { not: null, notIn: [...explicitTemplateIds] },
            splits: { some: { householdMemberId: { in: householdMemberIds } } },
          },
          _max: { date: true },
        })
      : [];
  const latestBillCandidates =
    latestBillDates.length > 0
      ? await prisma.transaction.findMany({
          where: {
            OR: latestBillDates.flatMap((row) =>
              row._max.date ? [{ recurringTemplateId: row.recurringTemplateId, date: row._max.date }] : [],
            ),
            splits: { some: { householdMemberId: { in: householdMemberIds } } },
          },
          select: {
            id: true,
            amount: true,
            recurringTemplateId: true,
            splits: { select: { householdMemberId: true, amountOwed: true } },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        })
      : [];
  const latestSplitBillByTemplate = new Map<string, (typeof latestBillCandidates)[number]>();
  for (const tx of latestBillCandidates) {
    if (!tx.recurringTemplateId || explicitTemplateIds.has(tx.recurringTemplateId)) continue;
    if (!latestSplitBillByTemplate.has(tx.recurringTemplateId)) {
      latestSplitBillByTemplate.set(tx.recurringTemplateId, tx);
    }
  }
  const inferredTemplates =
    latestSplitBillByTemplate.size > 0
      ? await prisma.recurringTemplate.findMany({
          where: {
            id: { in: [...latestSplitBillByTemplate.keys()] },
            householdId: { in: memberships.map((m) => m.household.id) },
          },
          include: {
            category: { select: { name: true } },
            // The template's latest bill overall, split or not. Bills the
            // user has no split row in are never candidates above, so
            // without this a household that split rent once and then
            // stopped would keep the user owing half of it every month.
            transactions: {
              where: { date: { lt: monthEnd } },
              orderBy: [{ date: "desc" }, { createdAt: "desc" }],
              take: 1,
              select: { id: true },
            },
          },
        })
      : [];

  type SharedTemplate = {
    template: Omit<(typeof inferredTemplates)[number], "transactions">;
    householdMemberId: string;
    amountOwed: number;
    splits: { householdMemberId: string; amountOwed: number }[];
  };
  const sharedTemplates: SharedTemplate[] = sharedTemplateSplits.map((s) => ({
    template: s.recurringTemplate,
    householdMemberId: s.householdMemberId,
    amountOwed: s.amountOwed,
    splits: s.recurringTemplate.splits,
  }));
  for (const template of inferredTemplates) {
    const bill = latestSplitBillByTemplate.get(template.id)!;
    // A later bill wasn't split with the user: they're no longer sharing it.
    if (template.transactions[0]?.id !== bill.id) continue;
    const memberId = myMemberIdIn(bill)!;
    // Scaled to the template's amount, in case the bill's differed (a
    // variable electricity bill, say): same proportions, today's total.
    const scale = bill.amount > 0 ? template.amount / bill.amount : 1;
    const splits = bill.splits.map((s) => ({
      householdMemberId: s.householdMemberId,
      amountOwed: Math.round(s.amountOwed * scale * 100) / 100,
    }));
    const mine = splits.find((s) => s.householdMemberId === memberId)!;
    // Payer-only on the last bill — not a cost for this user, same as 3a.
    if (mine.amountOwed <= 0) continue;
    sharedTemplates.push({ template, householdMemberId: memberId, amountOwed: mine.amountOwed, splits });
  }
  const sharedTemplateIds = sharedTemplates.map((s) => s.template.id);
  const [sharedTemplateTransactions, sharedTemplateAcks] = await Promise.all([
    sharedTemplateIds.length > 0
      ? prisma.transaction.findMany({
          // Only the window around the viewed period: a bill counts as
          // posted by sharing the template's period (week, month or year of
          // the reference date), which never reaches outside it.
          where: { recurringTemplateId: { in: sharedTemplateIds }, date: { gte: lookbackStart, lt: lookbackEnd } },
          select: { recurringTemplateId: true, date: true },
        })
      : Promise.resolve([]),
    sharedTemplateIds.length > 0
      ? prisma.recurringTemplateAck.findMany({
          where: { recurringTemplateId: { in: sharedTemplateIds } },
        })
      : Promise.resolve([]),
  ]);
  // computeTemplateStatuses (src/lib/recurring-template-calc.ts) is generic
  // and already used identically for both budgets — reused again here, run
  // from the personal side over the subset of RecurringTemplates the user
  // has a split in. A user has at most one split row per template (a
  // membership is unique per household+user, and a template belongs to one
  // household), so there's exactly one row per template here.
  //
  // UX-134: each template is judged on its own household's budget periods,
  // the same ones `assertNoDuplicateTemplatePeriod` guards on when the bill
  // is logged from the due row. Otherwise, with start day 25, a rent logged
  // on 28 Sep (the household's October) would leave a Due row here that the
  // guard then refuses to clear. The personal view runs on the user's own
  // periods, which needn't match the household's, so the reference date is
  // today when it falls in the viewed period (matching the date "Log
  // payment" pre-fills) and the period's start otherwise.
  const startDayByHousehold = new Map(
    memberships.map((m) => [m.household.id, normalizeStartDay(m.household.budgetMonthStartDay)]),
  );
  const statusReferenceDate = now >= monthStart && now < monthEnd ? now : monthStart;
  const sharedTemplateStatusRows = [...new Set(startDayByHousehold.values())].flatMap((householdStartDay) =>
    computeTemplateStatuses({
      templates: sharedTemplates
        .map((s) => s.template)
        .filter((t) => (startDayByHousehold.get(t.householdId) ?? 1) === householdStartDay),
      transactions: sharedTemplateTransactions,
      acks: sharedTemplateAcks,
      referenceDate: statusReferenceDate,
      monthEnd,
      startDay: householdStartDay,
    }),
  );
  const sharedDueRows: SharedDueRow[] = sharedTemplateStatusRows
    .filter((row) => row.status === "due")
    .map((row) => {
      const split = sharedTemplates.find((s) => s.template.id === row.template.id)!;
      return {
        id: row.template.id,
        name: row.template.name,
        categoryName: row.template.category.name,
        type: row.template.type,
        amount: split.amountOwed,
        householdName: householdByMemberId.get(split.householdMemberId)?.name ?? "",
        householdId: row.template.householdId,
        logPrefill: {
          householdId: row.template.householdId,
          templateId: row.template.id,
          categoryId: row.template.categoryId,
          amount: row.template.amount,
          description: row.template.name,
          frequency: row.template.frequency,
          splits: Object.fromEntries(split.splits.map((s) => [s.householdMemberId, s.amountOwed])),
        },
      };
    });

  // Planned bills (BUDGET-8): the user's share of every household one-off
  // bill that is still unpaid as of the viewed month's end (due or overdue —
  // see planned-expense-calc.ts). Appended to sharedDueRows *before*
  // expectedRecurring folds them in, so the existing fold counts them in
  // Safe to spend. Bills due after this month are "upcoming" and stay out;
  // a payer-only split (amountOwed 0) isn't a cost, hence the `gt: 0`. No
  // logPrefill: paying one is done from the household's Budget page, where
  // the bill's own "Log payment" links the transaction to it.
  const plannedSplits =
    householdMemberIds.length > 0
      ? await prisma.plannedExpenseSplit.findMany({
          where: {
            householdMemberId: { in: householdMemberIds },
            amountOwed: { gt: 0 },
            // Paid before the month started is history (never outstanding):
            // leave it to the database so this doesn't grow with every bill
            // ever paid. A payment dated later still counts as unpaid here.
            plannedExpense: {
              dueDate: { lt: monthEnd },
              OR: [{ transaction: { is: null } }, { transaction: { is: { date: { gte: monthStart } } } }],
            },
          },
          include: {
            plannedExpense: {
              include: {
                category: { select: { name: true } },
                transaction: { select: { date: true } },
              },
            },
          },
        })
      : [];
  for (const split of plannedSplits) {
    const bill = split.plannedExpense;
    const status = getPlannedExpenseStatus(
      { dueDate: bill.dueDate, paidAt: bill.transaction?.date ?? null },
      monthStart,
      monthEnd,
    );
    if (!isPlannedExpenseOutstanding(status)) continue;
    sharedDueRows.push({
      id: bill.id,
      name: bill.name,
      categoryName: bill.category.name,
      type: "EXPENSE",
      amount: split.amountOwed,
      householdName: householdByMemberId.get(split.householdMemberId)?.name ?? "",
      householdId: bill.householdId,
    });
  }

  // Every shared template the user still pays a share of, reduced to that
  // share — the Insights tab's "Fixed income & costs" counts it next to
  // their own recurring items (BUDGET-7, src/lib/personal-fixed-insights.ts).
  // Due or not: the fixed card is the planned month, not what's left of it.
  // A payer-only explicit split (amountOwed 0) isn't a cost, same as 3a.
  const sharedFixedTemplates = sharedTemplates
    .filter((s) => s.amountOwed > 0)
    .map((s) => ({
      id: s.template.id,
      name: s.template.name,
      amount: s.amountOwed,
      frequency: s.template.frequency,
      type: s.template.type,
      active: s.template.active,
      createdAt: s.template.createdAt,
    }));

  // --- Totals ----------------------------------------------------------------
  // Scoped to the selected month (monthTransactions, queried above) — see the
  // household budget's identical comment (src/app/dashboard/budget/page.tsx).

  // This month's shared shares (sharedPostedRows, the user's own
  // amountOwed) count toward the totals below alongside their own
  // transactions — otherwise a bill's share would leave "expected" the moment
  // it's logged (see sharedDueRows) without ever showing up as spent. Still a
  // read-only reference, not a copy: nothing is written to PersonalTransaction.
  // Keyed/labelled apart from personal categories so a personal "Rent" and a
  // shared "Rent" don't merge into one row.
  const sharedTotalEntries = sharedPostedRows.map((r) => ({
    categoryId: `shared:${r.categoryName}`,
    categoryName: `${r.categoryName} (${sharedLabel})`,
    type: r.type,
    amount: r.amount,
  }));

  const totalsByCategory = (type: "INCOME" | "EXPENSE" | "SAVINGS"): CategoryTotal[] => {
    const totals = new Map<string, CategoryTotal>();
    const entries = [
      ...monthTransactions.map((t) => ({
        categoryId: t.categoryId,
        categoryName: t.category.name,
        type: t.type,
        amount: t.amount,
      })),
      ...sharedTotalEntries,
    ];
    for (const t of entries) {
      if (t.type !== type) continue;
      const existing = totals.get(t.categoryId);
      if (existing) {
        existing.total += t.amount;
      } else {
        totals.set(t.categoryId, { id: t.categoryId, name: t.categoryName, total: t.amount });
      }
    }
    return [...totals.values()].sort((a, b) => b.total - a.total);
  };

  const incomeByCategory = totalsByCategory("INCOME");
  const expenseByCategory = totalsByCategory("EXPENSE");
  const savingsByCategory = totalsByCategory("SAVINGS");
  const income = incomeByCategory.reduce((sum, c) => sum + c.total, 0);
  const expense = expenseByCategory.reduce((sum, c) => sum + c.total, 0);
  const savings = savingsByCategory.reduce((sum, c) => sum + c.total, 0);

  // --- Recurring templates --------------------------------------------------
  // Mirrors the household budget's (src/app/dashboard/budget/page.tsx) —
  // see src/lib/recurring-template-calc.ts's doc comments.
  const activeRecurringTemplates = recurringTemplates.filter((t) => t.active);
  const templateStatusRows = computeTemplateStatuses({
    templates: activeRecurringTemplates,
    transactions: lookbackTransactions.map((t) => ({
      recurringTemplateId: t.recurringTemplateId,
      date: t.date,
    })),
    acks: recurringTemplateAcks.map((a) => ({
      recurringTemplateId: a.personalRecurringTemplateId,
      periodKey: a.periodKey,
    })),
    referenceDate: monthStart,
    monthEnd,
    startDay,
  });

  // --- Remaining after expenses and savings ---------------------------------
  // Same pure calc as the household budget's — see
  // src/lib/safe-to-spend-calc.ts — fed this user's own transactions and
  // recurring items.
  const { expectedRecurring: personalExpectedRecurring } = computeSafeToSpend({
    transactions: lookbackTransactions.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.category.name,
      type: t.type,
      amount: t.amount,
      date: t.date,
      isRecurring: t.isRecurring,
    })),
    monthStart,
    monthEnd,
    incomeSoFar: income,
    expenseSoFar: expense,
    savingsSoFar: savings,
    templates: templateStatusRows.map((row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      type: row.template.type,
      amount: row.template.amount,
      status: row.status,
    })),
    // The user's own due and overdue planned bills, at their full amount
    // (there's no one to share them with), and their planned income due
    // this month as expected income.
    plannedExpenses,
  });

  // Fold the user's due share of any *shared* household RecurringTemplate
  // (sharedDueRows, computed above) into the same "not yet logged" reduction
  // — this is what makes the headline number actually account for an unpaid
  // share of Rent, not just list it separately. Tagged with a `source` so
  // SafeToSpend's breakdown can badge shared rows distinctly from the user's
  // own personal estimate — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md.
  // A split *income* template's share is expected income, the same way a
  // posted split income already counts toward `income` above.
  const expectedRecurring: ExpectedRecurringExpense[] = [
    ...personalExpectedRecurring.map((e) => ({ ...e, source: "personal" as const })),
    ...sharedDueRows.map((row) => ({
      categoryId: row.id,
      categoryName: row.name,
      amount: row.amount,
      type: row.type,
      source: "shared" as const,
      householdName: showHouseholdName ? row.householdName : undefined,
    })),
  ].sort((a, b) => b.amount - a.amount);

  const limitEnvelopes = categoryEnvelopes({
    categories: limitedCategories,
    transactions: lookbackTransactions,
    monthStart,
    monthEnd,
    startDay,
  });
  const {
    safeToSpend,
    status: safeToSpendStatus,
    breakdown: safeToSpendBreakdown,
  }: { safeToSpend: number; status: SafeToSpendStatus; breakdown: SafeToSpendBreakdown } =
    deriveSafeToSpend({
      incomeSoFar: income,
      expenseSoFar: expense,
      savingsSoFar: savings,
      owedFromEarlier,
      stillBudgeted: computeStillBudgeted(limitEnvelopes, expectedRecurring),
      expectedRecurring,
    });

  // UX-39: the projected end-of-month line under the number, paced by the
  // user's own everyday spending this month (a shared bill's share is a
  // bill, so it stays out of the pace).
  const safeToSpendProjection = projectMonthEnd({
    safeToSpend,
    transactions: monthTransactions,
    monthStart,
    monthEnd,
    today: now,
    excludeCategoryIds: new Set(limitEnvelopes.map((e) => e.id)),
  });

  const safeToSpendDaily = dailyAllowance({ safeToSpend, monthStart, monthEnd, today: now });

  return {
    // The trailing window (see LOOKBACK_MONTHS), not the whole history: what
    // the page's category rollover and sparklines read.
    lookbackTransactions,
    monthTransactions,
    recurringTemplates,
    templateStatusRows,
    plannedExpenses,
    memberships,
    showHouseholdName,
    sharedPostedRows,
    sharedDueRows,
    sharedFixedTemplates,
    householdDebts,
    incomeByCategory,
    expenseByCategory,
    savingsByCategory,
    income,
    expense,
    savings,
    safeToSpend,
    safeToSpendStatus,
    safeToSpendBreakdown,
    safeToSpendProjection,
    safeToSpendDaily,
    expectedRecurring,
  };
}
