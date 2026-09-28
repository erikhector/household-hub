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
import {
  computeSafeToSpend,
  deriveSafeToSpend,
  type ExpectedRecurringExpense,
  type HouseholdDebt,
  type SafeToSpendBreakdown,
  type SafeToSpendStatus,
} from "@/lib/safe-to-spend-calc";
import {
  computeMemberPosition,
  remainingDue,
  type DatedMemberTransfer,
  type DatedSplitTransaction,
} from "@/lib/settle-up-calc";

export async function loadPersonalBudgetPosition({
  userId,
  monthStart,
  monthEnd,
  sharedLabel,
}: {
  userId: string;
  monthStart: Date;
  monthEnd: Date;
  /** dict.personalBudget.shared.sharedBadge — appended to a shared
   * category's name in the per-category totals, so a personal "Rent" and a
   * shared "Rent" don't merge into one row. */
  sharedLabel: string;
}) {
  const [transactions, recurringTemplates, recurringTemplateAcks, memberships] = await Promise.all([
    prisma.personalTransaction.findMany({
      where: { userId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { category: true },
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
      select: { id: true, household: { select: { id: true, name: true } } },
    }),
  ]);

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

  // Every split bill the user is part of, up to the end of the viewed month
  // — not just this month's. Older ones are what "owed from earlier months"
  // is made of; only bills with a split row for the user can move their
  // balance, so nothing else needs fetching. Every member's split row comes
  // along (not just the user's), since how much the user owes the bill vs.
  // the other members depends on what everyone paid.
  const [sharedTransactions, settlements] =
    householdMemberIds.length > 0
      ? await Promise.all([
          prisma.transaction.findMany({
            where: {
              date: { lt: monthEnd },
              splits: { some: { householdMemberId: { in: householdMemberIds } } },
            },
            include: {
              category: { select: { name: true } },
              splits: { include: { householdMember: { include: { user: { select: { displayName: true } } } } } },
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          }),
          prisma.memberSettlement.findMany({
            where: {
              date: { lt: monthEnd },
              OR: [{ fromMemberId: { in: householdMemberIds } }, { toMemberId: { in: householdMemberIds } }],
            },
          }),
        ])
      : [[], []];

  const myMemberIdIn = (tx: (typeof sharedTransactions)[number]) =>
    tx.splits.find((s) => householdMemberIds.includes(s.householdMemberId))?.householdMemberId;

  // 3a: already-posted split transactions this month.
  const sharedPostedRows: SharedPostedRow[] = [];
  for (const tx of sharedTransactions) {
    if (tx.date < monthStart) continue;
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
  const datedTransactions: DatedSplitTransaction[] = sharedTransactions.map((tx) => ({
    amount: tx.amount,
    date: tx.date,
    splits: tx.splits.map((s) => ({
      householdMemberId: s.householdMemberId,
      amountOwed: s.amountOwed,
      amountPaid: s.amountPaid,
    })),
  }));
  const datedTransfers: DatedMemberTransfer[] = settlements.map((s) => ({
    fromMemberId: s.fromMemberId,
    toMemberId: s.toMemberId,
    amount: s.amount,
    date: s.date,
  }));
  let owedFromEarlier = 0;
  const householdDebts: HouseholdDebt[] = [];
  for (const m of memberships) {
    const atStart = computeMemberPosition({
      memberId: m.id,
      transactions: datedTransactions,
      transfers: datedTransfers,
      asOf: monthStart,
    });
    owedFromEarlier += Math.max(0, -atStart.memberBalance) + atStart.owedToBills;
    const atEnd = computeMemberPosition({
      memberId: m.id,
      transactions: datedTransactions,
      transfers: datedTransfers,
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
  const sharedTemplateSplits =
    householdMemberIds.length > 0
      ? await prisma.recurringTemplateSplit.findMany({
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
        })
      : [];
  const explicitTemplateIds = new Set(sharedTemplateSplits.map((s) => s.recurringTemplateId));
  // sharedTransactions is newest first, so the first bill seen per template
  // is its latest one (up to the end of the viewed month).
  const latestSplitBillByTemplate = new Map<string, (typeof sharedTransactions)[number]>();
  for (const tx of sharedTransactions) {
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
            // user has no split row in never reach sharedTransactions, so
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
          where: { recurringTemplateId: { in: sharedTemplateIds } },
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
  const sharedTemplateStatusRows = computeTemplateStatuses({
    templates: sharedTemplates.map((s) => s.template),
    transactions: sharedTemplateTransactions,
    acks: sharedTemplateAcks,
    referenceDate: monthStart,
    monthEnd,
  });
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

  // --- Totals ----------------------------------------------------------------
  // Scoped to the selected month — see the household budget's identical
  // monthTransactions comment (src/app/dashboard/budget/page.tsx).
  const monthTransactions = transactions.filter((t) => t.date >= monthStart && t.date < monthEnd);

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
    transactions: transactions.map((t) => ({
      recurringTemplateId: t.recurringTemplateId,
      date: t.date,
    })),
    acks: recurringTemplateAcks.map((a) => ({
      recurringTemplateId: a.personalRecurringTemplateId,
      periodKey: a.periodKey,
    })),
    referenceDate: monthStart,
    monthEnd,
  });

  // --- Remaining after expenses and savings ---------------------------------
  // Same pure calc as the household budget's — see
  // src/lib/safe-to-spend-calc.ts — fed this user's own transactions and
  // recurring items.
  const { expectedRecurring: personalExpectedRecurring } = computeSafeToSpend({
    transactions: transactions.map((t) => ({
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
      expectedRecurring,
    });

  return {
    transactions,
    monthTransactions,
    recurringTemplates,
    templateStatusRows,
    memberships,
    showHouseholdName,
    sharedPostedRows,
    sharedDueRows,
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
    expectedRecurring,
  };
}
