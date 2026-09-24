import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { ExportButton } from "@/components/export/export-button";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { PersonalBudgetTabs } from "@/components/personal-budget/personal-budget-tabs";
import { CategoryManager } from "@/components/budget/category-manager";
import {
  PersonalRecurringTemplatesPanel,
  type PausedPersonalRecurringTemplateRow,
  type PersonalRecurringTemplateListRow,
} from "@/components/personal-budget/personal-recurring-templates-panel";
import {
  PersonalTransactionList,
  type SharedPostedRow,
} from "@/components/personal-budget/personal-transaction-list";
import type { SharedDueRow } from "@/components/personal-budget/personal-due-recurring-widget";
import type { ShareableHousehold } from "@/components/personal-budget/log-shared-expense-dialog";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import {
  computeBudgetBalanceStatus,
  computeFixedMonthlySummary,
  computeRecurringBreakdown,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
} from "@/lib/recurring-template-calc";
import {
  computeSafeToSpend,
  deriveSafeToSpend,
  type ExpectedRecurringExpense,
} from "@/lib/safe-to-spend-calc";
import {
  getMonthEnd,
  getMonthStart,
  isMonthKey,
  parseMonthKey,
  toMonthKey,
} from "@/lib/budget-date-utils";
import {
  createPersonalCategoryAction,
  deletePersonalCategoryAction,
  updatePersonalCategoryAction,
} from "./actions";

// Same cap as the household budget's cost analyzer / fixed trend chart.
const MAX_FIXED_TREND_MONTHS = 12;

export default async function PersonalBudgetPage(props: PageProps<"/dashboard/personal-budget">) {
  const [userId, dict, locale, searchParams] = await Promise.all([
    requireUserId(),
    getDictionary(),
    getLocale(),
    props.searchParams,
  ]);

  const monthParam = searchParams.month;
  const monthParamValue = Array.isArray(monthParam) ? monthParam[0] : monthParam;
  const now = new Date();
  const monthStart = isMonthKey(monthParamValue) ? parseMonthKey(monthParamValue) : getMonthStart(now);
  const monthEnd = getMonthEnd(monthStart);
  const monthKey = toMonthKey(monthStart);

  const [categories, transactions, recurringTemplates, recurringTemplateAcks] = await Promise.all([
    prisma.personalBudgetCategory.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
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
  ]);

  const categoryRows = categories.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  // --- Shared with your household -------------------------------------------
  // See docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md: a read-only mirror of the user's
  // own share of split household costs, aggregated across every household
  // they belong to (not just the "active" one — a user's rent share
  // shouldn't disappear from their personal budget just because a different
  // household is selected elsewhere in the app). Never a full transaction/
  // template amount, always this user's own `amountOwed` share.
  const memberships = await prisma.householdMember.findMany({
    where: { userId },
    select: { id: true, household: { select: { id: true, name: true } } },
  });
  const householdMemberIds = memberships.map((m) => m.id);
  const householdNameByMemberId = new Map(memberships.map((m) => [m.id, m.household]));
  // Only shown on each row once the user is in more than one household —
  // see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6 ("don't clutter the common
  // case").
  const showHouseholdName = memberships.length > 1;

  // Households the user can log a shared expense into directly from this
  // page (LogSharedExpenseDialog) — the entry-point half of the personal
  // ↔ household link, complementing the read-only mirror above. Only
  // households with more than one member qualify (nothing to split
  // otherwise), same gating TransactionDialog uses for its own split UI.
  const sharedExpenseHouseholds: ShareableHousehold[] = (
    await Promise.all(
      memberships.map(async (m) => {
        const [members, householdCategories] = await Promise.all([
          prisma.householdMember.findMany({
            where: { householdId: m.household.id },
            include: { user: { select: { displayName: true } } },
          }),
          prisma.budgetCategory.findMany({
            where: { householdId: m.household.id },
            orderBy: [{ type: "asc" }, { name: "asc" }],
          }),
        ]);
        return {
          id: m.household.id,
          name: m.household.name,
          currentMemberId: m.id,
          members: members.map((hm) => ({ id: hm.id, displayName: hm.user.displayName })),
          categories: householdCategories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
        };
      }),
    )
  ).filter((h) => h.members.length > 1);

  // 3a: already-posted split transactions this month (no schema change
  // needed — a pure join over TransactionSplit/Transaction).
  const sharedSplits =
    householdMemberIds.length > 0
      ? await prisma.transactionSplit.findMany({
          where: {
            householdMemberId: { in: householdMemberIds },
            transaction: { date: { gte: monthStart, lt: monthEnd } },
          },
          include: {
            transaction: {
              include: {
                category: { select: { name: true } },
                paidByMember: { include: { user: { select: { displayName: true } } } },
              },
            },
          },
          orderBy: { transaction: { date: "desc" } },
        })
      : [];
  const sharedPostedRows: SharedPostedRow[] = sharedSplits.map((split) => ({
    id: split.id,
    categoryName: split.transaction.category.name,
    amount: split.amountOwed,
    type: split.transaction.type,
    date: split.transaction.date,
    householdId: householdNameByMemberId.get(split.householdMemberId)?.id ?? "",
    householdName: householdNameByMemberId.get(split.householdMemberId)?.name ?? "",
    paidByName: split.transaction.paidByMember?.user.displayName ?? null,
  }));

  // 3b: due-but-not-yet-posted shared RecurringTemplates — the literal "Rent
  // pops up" case. Only templates a household member has explicitly opted
  // into a split show up here; every other template stays completely
  // invisible (no retroactive backfill).
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
  const sharedTemplateIds = [...new Set(sharedTemplateSplits.map((s) => s.recurringTemplateId))];
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
    templates: sharedTemplateSplits.map((s) => s.recurringTemplate),
    transactions: sharedTemplateTransactions,
    acks: sharedTemplateAcks,
    referenceDate: monthStart,
    monthEnd,
  });
  const sharedDueRows: SharedDueRow[] = sharedTemplateStatusRows
    .filter((row) => row.status === "due")
    .map((row) => {
      const split = sharedTemplateSplits.find((s) => s.recurringTemplateId === row.template.id)!;
      return {
        id: row.template.id,
        name: row.template.name,
        categoryName: row.template.category.name,
        amount: split.amountOwed,
        householdName: householdNameByMemberId.get(split.householdMemberId)?.name ?? "",
        logPrefill: {
          householdId: row.template.householdId,
          templateId: row.template.id,
          categoryId: row.template.categoryId,
          amount: row.template.amount,
          description: row.template.name,
          frequency: row.template.frequency,
          splits: Object.fromEntries(
            row.template.splits.map((s) => [s.householdMemberId, s.amountOwed]),
          ),
        },
      };
    });

  // Scoped to the selected month — see the household budget's identical
  // monthTransactions comment (src/app/dashboard/budget/page.tsx).
  const monthTransactions = transactions.filter((t) => t.date >= monthStart && t.date < monthEnd);

  const transactionRows = monthTransactions.map((t) => ({
    id: t.id,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    type: t.type,
    amount: t.amount,
    description: t.description,
    date: t.date,
    isRecurring: t.isRecurring,
    recurrenceFrequency: t.recurrenceFrequency,
  }));

  // This month's posted shared shares (sharedPostedRows, the user's own
  // amountOwed) count toward the totals below alongside their own
  // transactions — otherwise a bill's share would leave "expected" the moment
  // it's logged (see sharedDueRows) without ever showing up as spent. Still a
  // read-only reference, not a copy: nothing is written to PersonalTransaction.
  // Keyed/labelled apart from personal categories so a personal "Rent" and a
  // shared "Rent" don't merge into one row.
  const sharedTotalEntries = sharedPostedRows.map((r) => ({
    categoryId: `shared:${r.categoryName}`,
    categoryName: `${r.categoryName} (${dict.personalBudget.shared.sharedBadge})`,
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

  // Same pure calc as the household budget's Safe to spend — see
  // src/lib/safe-to-spend-calc.ts — fed this user's own transactions instead.
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
  });

  // Fold the user's due share of any *shared* household RecurringTemplate
  // (sharedDueRows, computed above) into the same "not yet logged" reduction
  // — this is what makes the headline safe-to-spend number actually account
  // for an unpaid share of Rent, not just list it separately. Tagged with a
  // `source` so SafeToSpend's breakdown can badge shared rows distinctly
  // from the user's own personal estimate — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md.
  const expectedRecurring: ExpectedRecurringExpense[] = [
    ...personalExpectedRecurring.map((e) => ({ ...e, source: "personal" as const })),
    ...sharedDueRows.map((row) => ({
      categoryId: row.id,
      categoryName: row.name,
      amount: row.amount,
      source: "shared" as const,
      householdName: showHouseholdName ? row.householdName : undefined,
    })),
  ].sort((a, b) => b.amount - a.amount);

  const { safeToSpend, status: safeToSpendStatus } = deriveSafeToSpend({
    incomeSoFar: income,
    expenseSoFar: expense,
    savingsSoFar: savings,
    expectedRecurring,
  });

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
  const recurringTemplateRows: PersonalRecurringTemplateListRow[] = templateStatusRows.map(
    (row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      categoryName: row.template.category.name,
      amount: row.template.amount,
      frequency: row.template.frequency,
      dayOfMonth: row.template.dayOfMonth,
      status: row.status,
    }),
  );
  const pausedRecurringTemplateRows: PausedPersonalRecurringTemplateRow[] = recurringTemplates
    .filter((t) => !t.active)
    .map((t) => ({
      id: t.id,
      name: t.name,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      amount: t.amount,
      frequency: t.frequency,
      dayOfMonth: t.dayOfMonth,
    }));

  // --- Fixed income & costs summary -----------------------------------------
  // Mirrors the household budget's (src/app/dashboard/budget/page.tsx) — see
  // src/lib/recurring-template-calc.ts's doc comments, including both calcs'
  // internal createdAt-vs-monthEnd cutoff.
  const fixedMonthlySummary = computeFixedMonthlySummary(recurringTemplates, monthEnd);
  const fixedMonthlyTotals = computeRecurringMonthlyTotals({
    transactions: transactions.map((t) => ({
      type: t.type,
      amount: t.amount,
      date: t.date,
      recurringTemplateId: t.recurringTemplateId,
    })),
    referenceDate: now,
    monthsBack: MAX_FIXED_TREND_MONTHS,
  });
  // Mirrors the household budget's breakdown/balance-status calc (see
  // src/app/dashboard/budget/page.tsx).
  const fixedIncomeBreakdown = computeRecurringBreakdown(recurringTemplates, "INCOME", monthEnd).map(
    (item) => ({ id: item.id, name: item.name, total: item.monthlyAmount }),
  );
  const fixedExpenseBreakdown = computeRecurringBreakdown(recurringTemplates, "EXPENSE", monthEnd).map(
    (item) => ({ id: item.id, name: item.name, total: item.monthlyAmount }),
  );
  const budgetBalanceStatus = computeBudgetBalanceStatus(fixedMonthlySummary);

  // --- Manage tab: recurring items + categories -----------------------------
  // Grouped together — see budget-tabs.tsx's doc comment (this mirrors the
  // household budget's own Manage tab).
  const manage = (
    <div className="flex flex-col gap-6">
      <PersonalRecurringTemplatesPanel
        templates={recurringTemplateRows}
        pausedTemplates={pausedRecurringTemplateRows}
        categories={categoryRows}
        monthKey={monthKey}
        dict={dict.personalBudget}
        locale={locale}
      />
      <CategoryManager
        categories={categoryRows}
        dict={dict.personalBudget}
        createAction={createPersonalCategoryAction}
        updateAction={updatePersonalCategoryAction}
        deleteAction={deletePersonalCategoryAction}
      />
    </div>
  );

  // Shared household costs (sharedPostedRows — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md)
  // are merged straight into the normal transaction list, badged as
  // "Shared" rather than shown in a separate section. Still read-only here:
  // PersonalTransactionList renders a "View in {household} Budget" link for
  // these rows instead of edit/delete controls, since the household budget
  // stays the one place they get logged, edited, or acknowledged.
  const transactionsTab = (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <ExportButton href="/dashboard/personal-budget/export" label={dict.export.button} />
      </div>
      <PersonalTransactionList
        transactions={transactionRows}
        sharedRows={sharedPostedRows}
        showHouseholdName={showHouseholdName}
        monthKey={monthKey}
        categories={categoryRows}
        dict={dict.personalBudget}
        locale={locale}
      />
    </div>
  );

  // Selected month's income/expense/savings breakdown — shown on both
  // Overview and Insights, see BudgetTabs's identical periodSummary comment
  // (src/components/budget/budget-tabs.tsx).
  const periodSummary = (
    <PeriodSummary
      income={income}
      expense={expense}
      savings={savings}
      incomeByCategory={incomeByCategory}
      expenseByCategory={expenseByCategory}
      savingsByCategory={savingsByCategory}
      dict={dict.personalBudget.summary}
      locale={locale}
    />
  );

  const insights = (
    <div className="flex flex-col gap-6">
      {periodSummary}
      <FixedBudgetSummary
        monthlyIncome={fixedMonthlySummary.monthlyIncome}
        monthlyExpense={fixedMonthlySummary.monthlyExpense}
        monthlySavings={fixedMonthlySummary.monthlySavings}
        monthlyTotals={fixedMonthlyTotals}
        balanceStatus={budgetBalanceStatus}
        incomeBreakdown={fixedIncomeBreakdown}
        expenseBreakdown={fixedExpenseBreakdown}
        dict={dict.personalBudget.fixedSummary}
        locale={locale}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.personalBudget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.personalBudget.subtitle}</p>
      </div>

      <PersonalBudgetTabs
        dict={dict.personalBudget}
        locale={locale}
        monthKey={monthKey}
        categories={categoryRows}
        safeToSpendAmount={safeToSpend}
        safeToSpendStatus={safeToSpendStatus}
        safeToSpendExpectedRecurring={expectedRecurring}
        dueTemplates={recurringTemplateRows.filter((r) => r.status === "due")}
        hasRecurringTemplates={recurringTemplateRows.length > 0}
        sharedDueRows={sharedDueRows}
        showHouseholdName={showHouseholdName}
        sharedExpenseHouseholds={sharedExpenseHouseholds}
        createCategoryAction={createPersonalCategoryAction}
        periodSummary={periodSummary}
        manage={manage}
        transactions={transactionsTab}
        insights={insights}
      />
    </div>
  );
}
