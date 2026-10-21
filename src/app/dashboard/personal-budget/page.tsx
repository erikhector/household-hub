import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { ExportButton } from "@/components/export/export-button";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { BudgetTabs } from "@/components/budget/budget-tabs";
import { PersonalBudgetOnboarding } from "@/components/personal-budget/personal-budget-onboarding";
import { CategoryManager } from "@/components/budget/category-manager";
import {
  RecurringTemplatesPanel,
  type PausedRecurringTemplateRow,
  type RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import {
  PlannedExpensesPanel,
  type PlannedExpenseRow,
} from "@/components/budget/planned-expenses-panel";
import { TransactionList } from "@/components/budget/transaction-list";
import { localDateKey } from "@/lib/budget-transaction-days";
import { budgetHref, resolveCategoryFilter } from "@/lib/budget-url";
import { RECENT_CATEGORY_SAMPLE, recentCategoryIds } from "@/lib/recent-categories";
import type { ShareableHousehold } from "@/components/personal-budget/log-shared-expense-dialog";
import { PeriodSummary } from "@/components/budget/period-summary";
import { SavingsGoals } from "@/components/budget/savings-goals";
import { savingsGoalRows } from "@/lib/savings-goal-calc";
import { categoriesNearLimit, withCategoryLimits } from "@/lib/budget-category-limit";
import { withCategoryRollover } from "@/lib/budget-rollover-calc";
import { withSpendHistory } from "@/lib/chart-calc";
import {
  acknowledgePersonalTemplatePeriodAction,
  createPersonalRecurringTemplateAction,
  createPersonalTransactionAction,
  deletePersonalRecurringTemplateAction,
  deletePersonalTransactionAction,
  logPersonalRecurringTemplateAction,
  setPersonalRecurringTemplateActiveAction,
  unacknowledgePersonalTemplatePeriodAction,
  updatePersonalRecurringTemplateAction,
  updatePersonalTransactionAction,
} from "@/app/dashboard/personal-budget/actions";
import {
  createPersonalPlannedExpenseAction,
  deletePersonalPlannedExpenseAction,
  updatePersonalPlannedExpenseAction,
} from "@/app/dashboard/personal-budget/planned-expense-actions";
import { isPlannedItemCounted } from "@/lib/planned-expense-calc";
import { computePersonalFixedInsights } from "@/lib/personal-fixed-insights";
import { loadPersonalBudgetPosition } from "@/lib/personal-budget-position";
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
import { PageTitle } from "@/components/dashboard/page-title";

// Same cap as the household budget's cost analyzer / fixed trend chart.
const MAX_FIXED_TREND_MONTHS = 12;

// SCALE-J: unlike the household budget page, nothing here is independent
// enough of everything else to earn its own Suspense boundary — the
// "shared with your household" mirror (sharedDueRows/sharedExpenseHouseholds)
// feeds straight into the same safe-to-spend number and BudgetTabs props as
// the user's own PersonalTransaction/PersonalRecurringTemplate data, so
// splitting it out would just mean BudgetTabs itself waiting on two Suspense
// children instead of one. Kept as a single section behind one boundary —
// the real win is still there: the static header below (and, unlike the
// household page, there's no read-only banner here to render alongside it)
// no longer waits on any of this.
async function PersonalBudgetTabsSection({
  userId,
  dict,
  locale,
  monthStart,
  monthEnd,
  monthKey,
  now,
}: {
  userId: string;
  dict: Dictionary;
  locale: Locale;
  monthStart: Date;
  monthEnd: Date;
  monthKey: string;
  now: Date;
}) {
  // Transactions, the shared-with-your-household mirror, totals and the
  // headline number all come from one loader shared with the dashboard's
  // "Your budget" card, so the two can't drift apart — see
  // src/lib/personal-budget-position.ts.
  const [categories, position, sharedTrendSplits, latestTransactions] = await Promise.all([
    prisma.personalBudgetCategory.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    loadPersonalBudgetPosition({
      userId,
      monthStart,
      monthEnd,
      sharedLabel: dict.personalBudget.shared.sharedBadge,
    }),
    // BUDGET-7: the user's share of split household bills logged from a
    // recurring template, for the fixed trend chart below. Its own query
    // because the trend runs back from today, while the loader's split
    // bills stop at the end of the viewed month. Scoped through the user's
    // own memberships and only ever their own split row (amountOwed), never
    // another member's or the whole bill. A payer-only row (amountOwed 0)
    // isn't a cost of theirs — see the loader's sharedPostedRows.
    prisma.transactionSplit.findMany({
      where: {
        householdMember: { userId },
        amountOwed: { gt: 0 },
        transaction: {
          recurringTemplateId: { not: null },
          date: { gte: new Date(now.getFullYear(), now.getMonth() - (MAX_FIXED_TREND_MONTHS - 1), 1) },
        },
      },
      select: {
        amountOwed: true,
        transaction: { select: { type: true, date: true, recurringTemplateId: true } },
      },
    }),
    // UX-109: the user's last-logged categories, for the Add transaction
    // sheet (see the household page's identical query).
    prisma.personalTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: RECENT_CATEGORY_SAMPLE,
      select: { categoryId: true },
    }),
  ]);
  const {
    transactions,
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
  } = position;

  const categoryRows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    monthlyLimit: c.monthlyLimit,
    rolloverEnabled: c.rolloverEnabled,
    goalAmount: c.goalAmount,
    goalDate: c.goalDate,
  }));

  // Households the user can log a shared expense into directly from this
  // page (LogSharedExpenseDialog) — the entry-point half of the personal
  // ↔ household link, complementing the read-only mirror in the loader
  // above. Only households with more than one member qualify (nothing to
  // split otherwise), same gating TransactionDialog uses for its own split UI.
  const sharedExpenseHouseholdIds = memberships.map((m) => m.household.id);
  // One query per table for every household at once (not two per
  // membership), grouped in memory below.
  const [allHouseholdMembers, allHouseholdCategories] = sharedExpenseHouseholdIds.length
    ? await Promise.all([
        prisma.householdMember.findMany({
          where: { householdId: { in: sharedExpenseHouseholdIds } },
          include: { user: { select: { displayName: true } } },
        }),
        prisma.budgetCategory.findMany({
          where: { householdId: { in: sharedExpenseHouseholdIds } },
          orderBy: [{ type: "asc" }, { name: "asc" }],
        }),
      ])
    : [[], []];
  const sharedExpenseHouseholds: ShareableHousehold[] = memberships
    .map((m) => ({
      id: m.household.id,
      name: m.household.name,
      currentMemberId: m.id,
      members: allHouseholdMembers
        .filter((hm) => hm.householdId === m.household.id)
        .map((hm) => ({ id: hm.id, displayName: hm.user.displayName })),
      categories: allHouseholdCategories
        .filter((c) => c.householdId === m.household.id)
        .map((c) => ({ id: c.id, name: c.name, type: c.type })),
    }))
    .filter((h) => h.members.length > 1);

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
    // TransactionList/TransactionDialog are now shared with the household
    // budget (BUDGET-2) — a PersonalTransaction has no split concept, so
    // this is always empty, the same "empty-array-safe" convention
    // `members={[]}` already uses to suppress that UI.
    splits: [],
  }));

  // --- Recurring templates --------------------------------------------------
  // Statuses come from the loader (templateStatusRows) — mirrors the
  // household budget's, see src/lib/recurring-template-calc.ts.
  // splits: [] below — RecurringTemplateDialog's/RecurringTemplatesPanel's
  // template-splitting feature is now shared with the household budget
  // (BUDGET-2), and a PersonalRecurringTemplate has no split concept, same
  // reasoning as transactionRows's splits above.
  const recurringTemplateRows: RecurringTemplateListRow[] = templateStatusRows.map(
    (row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      categoryName: row.template.category.name,
      amount: row.template.amount,
      frequency: row.template.frequency,
      dayOfMonth: row.template.dayOfMonth,
      status: row.status,
      splits: [],
    }),
  );
  const pausedRecurringTemplateRows: PausedRecurringTemplateRow[] = recurringTemplates
    .filter((t) => !t.active)
    .map((t) => ({
      id: t.id,
      name: t.name,
      categoryId: t.categoryId,
      categoryName: t.category.name,
      amount: t.amount,
      frequency: t.frequency,
      dayOfMonth: t.dayOfMonth,
      splits: [],
    }));

  // --- Planned bills ---------------------------------------------------------
  // The user's own, with statuses from the loader. splits: [] for the same
  // reason as the recurring rows above: nothing to split on a personal budget.
  const plannedExpenseRows: PlannedExpenseRow[] = plannedExpenses.map((p) => ({ ...p, splits: [] }));

  // --- Fixed income & costs summary -----------------------------------------
  // Mirrors the household budget's (src/app/dashboard/budget/page.tsx), plus
  // the user's share of shared household recurring bills (BUDGET-7) — see
  // src/lib/personal-fixed-insights.ts.
  const fixedInsights = computePersonalFixedInsights({
    templates: recurringTemplates,
    transactions: transactions.map((t) => ({
      type: t.type,
      amount: t.amount,
      date: t.date,
      recurringTemplateId: t.recurringTemplateId,
    })),
    sharedTemplates: sharedFixedTemplates,
    sharedTransactions: sharedTrendSplits.map((s) => ({
      type: s.transaction.type,
      amount: s.amountOwed,
      date: s.transaction.date,
      recurringTemplateId: s.transaction.recurringTemplateId,
    })),
    monthEnd,
    referenceDate: now,
    monthsBack: MAX_FIXED_TREND_MONTHS,
    sharedLabel: dict.personalBudget.shared.sharedBadge,
  });

  // --- Manage tab: recurring items, planned bills and income + categories ---
  // Grouped together — see budget-tabs.tsx's doc comment (this mirrors the
  // household budget's own Manage tab).
  const manage = (
    <div className="flex flex-col gap-6">
      <RecurringTemplatesPanel
        templates={recurringTemplateRows}
        pausedTemplates={pausedRecurringTemplateRows}
        categories={categoryRows}
        monthKey={monthKey}
        dict={dict.personalBudget}
        locale={locale}
        onTogglePause={setPersonalRecurringTemplateActiveAction}
        onDelete={deletePersonalRecurringTemplateAction}
        onAcknowledge={acknowledgePersonalTemplatePeriodAction}
        onUnacknowledge={unacknowledgePersonalTemplatePeriodAction}
        createTemplateAction={createPersonalRecurringTemplateAction}
        updateTemplateAction={updatePersonalRecurringTemplateAction}
        createTransactionAction={createPersonalTransactionAction}
        updateTransactionAction={updatePersonalTransactionAction}
      />
      {(["EXPENSE", "INCOME"] as const).map((kind) => (
        <PlannedExpensesPanel
          key={kind}
          kind={kind}
          rows={plannedExpenseRows.filter((r) => r.type === kind)}
          categories={categoryRows}
          members={[]}
          currentMemberId=""
          monthKey={monthKey}
          dict={dict.personalBudget}
          locale={locale}
          createAction={createPersonalPlannedExpenseAction}
          updateAction={updatePersonalPlannedExpenseAction}
          onDelete={deletePersonalPlannedExpenseAction}
          createTransactionAction={createPersonalTransactionAction}
          updateTransactionAction={updatePersonalTransactionAction}
        />
      ))}
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
  // TransactionList renders a "View in {household} Budget" link for
  // these rows instead of edit/delete controls, since the household budget
  // stays the one place they get logged, edited, or acknowledged.
  const transactionsTab = (
    <div className="flex flex-col gap-6">
      <TransactionList
        transactions={transactionRows}
        sharedRows={sharedPostedRows}
        showHouseholdName={showHouseholdName}
        monthKey={monthKey}
        categories={categoryRows}
        members={[]}
        currentMemberId=""
        dict={dict.personalBudget}
        locale={locale}
        todayKey={localDateKey(now)}
        onDelete={deletePersonalTransactionAction}
        createAction={createPersonalTransactionAction}
        updateAction={updatePersonalTransactionAction}
      />
      {/* Below the list, like the household budget's (rarely needed). */}
      <div className="flex justify-start">
        <ExportButton href="/dashboard/personal-budget/export" label={dict.export.button} />
      </div>
    </div>
  );

  // Selected month's income/expense/savings breakdown, on Insights only —
  // see the household page's identical comment.
  // UX-108: the rows Insights draws "Expenses by category" from, also what
  // the Overview's near-or-over-limit list reads, so both agree.
  const expenseRows = withSpendHistory(
    withCategoryRollover(
      withCategoryLimits(expenseByCategory, categories),
      categories,
      transactions,
      monthStart,
    ),
    transactions,
    monthStart,
  );
  const limitAlerts = categoriesNearLimit(expenseRows).map((alert) => ({
    ...alert,
    href: resolveCategoryFilter(alert.id, categoryRows)
      ? budgetHref("/dashboard/personal-budget", { month: monthKey, tab: "transactions", category: alert.id })
      : null,
  }));

  const periodSummary = (
    <PeriodSummary
      income={income}
      expense={expense}
      savings={savings}
      remaining={safeToSpend}
      incomeByCategory={incomeByCategory}
      // GAP-12 — see the household page's identical comment. The
      // shared-household mirror rows (`shared:` ids) never match a
      // personal category, so they keep their plain proportional bar.
      // GAP-21: the loader's `transactions` is the user's whole history, so
      // the carried balance (at most back to January — see
      // src/lib/budget-rollover-calc.ts) needs no extra query either.
      // UX-39: each row's sparkline, from the same whole history.
      expenseByCategory={expenseRows}
      monthStart={monthStart}
      savingsByCategory={savingsByCategory}
      // P3: each of the viewer's own categories drills into Transactions,
      // filtered to it, for the same month.
      categoryHref={(id) =>
        resolveCategoryFilter(id, categoryRows)
          ? budgetHref("/dashboard/personal-budget", { month: monthKey, tab: "transactions", category: id })
          : null
      }
      dict={dict.personalBudget.summary}
      locale={locale}
    />
  );

  // GAP-22 — see the household page's identical card. The loader's
  // `transactions` is already the user's whole history, so each category's
  // all-time savings are summed here rather than with another query. It
  // holds only the user's own PersonalTransactions (the shared-household
  // mirror is kept separately), so nothing household-side counts towards a
  // personal goal.
  const savedByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "SAVINGS") continue;
    savedByCategory.set(t.categoryId, (savedByCategory.get(t.categoryId) ?? 0) + t.amount);
  }
  const savingsGoals = (
    <SavingsGoals
      goals={savingsGoalRows(categories, savedByCategory, now)}
      dict={dict.personalBudget.savingsGoals}
      locale={locale}
    />
  );

  const insights = (
    <div className="flex flex-col gap-6">
      {periodSummary}
      <FixedBudgetSummary
        monthlyIncome={fixedInsights.summary.monthlyIncome}
        monthlyExpense={fixedInsights.summary.monthlyExpense}
        monthlySavings={fixedInsights.summary.monthlySavings}
        monthlyTotals={fixedInsights.monthlyTotals}
        balanceStatus={fixedInsights.balanceStatus}
        incomeBreakdown={fixedInsights.incomeBreakdown}
        expenseBreakdown={fixedInsights.expenseBreakdown}
        dict={dict.personalBudget.fixedSummary}
        locale={locale}
      />
    </div>
  );

  return (
    <BudgetTabs
      dict={dict.personalBudget}
      locale={locale}
      monthKey={monthKey}
      currentMonthKey={toMonthKey(now)}
      basePath="/dashboard/personal-budget"
      categories={categoryRows}
      safeToSpendAmount={safeToSpend}
      safeToSpendStatus={safeToSpendStatus}
      safeToSpendBreakdown={safeToSpendBreakdown}
      safeToSpendExpectedRecurring={expectedRecurring}
      safeToSpendProjection={safeToSpendProjection}
      safeToSpendDaily={safeToSpendDaily}
      limitAlerts={limitAlerts}
      householdDebts={householdDebts}
      dueTemplates={recurringTemplateRows.filter((r) => r.status === "due")}
      hasRecurringTemplates={recurringTemplateRows.length > 0}
      plannedDue={plannedExpenseRows.filter((r) => isPlannedItemCounted(r.status, r.type))}
      sharedDueRows={sharedDueRows}
      showHouseholdName={showHouseholdName}
      sharedExpenseHouseholds={sharedExpenseHouseholds}
      logSharedDialogDict={dict.personalBudget}
      createTransactionAction={createPersonalTransactionAction}
      updateTransactionAction={updatePersonalTransactionAction}
      deleteTransactionAction={deletePersonalTransactionAction}
      recentCategoryIds={recentCategoryIds(latestTransactions)}
      onAcknowledgeTemplate={acknowledgePersonalTemplatePeriodAction}
      onLogTemplateAsIs={logPersonalRecurringTemplateAction}
      savingsGoals={savingsGoals}
      onboarding={
        <PersonalBudgetOnboarding
          dict={dict.personalBudget}
          createCategoryAction={createPersonalCategoryAction}
        />
      }
      manage={manage}
      transactions={transactionsTab}
      insights={insights}
    />
  );
}

// Same shape as the household budget's BudgetTabsSkeleton — see
// src/app/dashboard/budget/page.tsx.
function PersonalBudgetTabsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex animate-pulse flex-col gap-6" role="status" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <div className="h-9 w-9 rounded-md bg-muted" />
        <div className="h-6 w-32 rounded-md bg-muted" />
        <div className="h-9 w-9 rounded-md bg-muted" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="h-9 w-64 rounded-md bg-muted" />
        <div className="h-9 w-32 rounded-md bg-muted" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{dict.personalBudget.title}</PageTitle>
        {/* Phone pass (Oct 2026), P6: hidden on phones, where the title,
            month bar and tabs already filled ~40% of the first screen
            before any number showed. */}
        <p className="text-sm text-muted-foreground max-sm:hidden">{dict.personalBudget.subtitle}</p>
        {/* UX-110: phones get one line saying what this budget is for. */}
        <p className="text-sm text-muted-foreground sm:hidden">{dict.personalBudget.purpose}</p>
      </div>

      <Suspense fallback={<PersonalBudgetTabsSkeleton label={dict.common.loading} />}>
        <PersonalBudgetTabsSection
          userId={userId}
          dict={dict}
          locale={locale}
          monthStart={monthStart}
          monthEnd={monthEnd}
          monthKey={monthKey}
          now={now}
        />
      </Suspense>
    </div>
  );
}
