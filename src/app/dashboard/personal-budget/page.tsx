import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { ExportButton } from "@/components/export/export-button";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { BudgetTabs } from "@/components/budget/budget-tabs";
import { LazyDialogErrorMessage } from "@/components/ui/lazy-dialog";
import { BudgetOnboarding } from "@/components/budget/budget-onboarding";
import { SharedCostsCard } from "@/components/personal-budget/shared-costs-card";
import { summarizeSharedCosts } from "@/lib/shared-costs-summary";
import { CategoryManager } from "@/components/budget/category-manager";
import type {
  PausedRecurringTemplateRow,
  RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import { BillsAndIncomePanel } from "@/components/budget/bills-and-income-panel";
import type { PlannedExpenseRow } from "@/components/budget/planned-expenses-panel";
import { TransactionList } from "@/components/budget/transaction-list";
import { localDateKey } from "@/lib/budget-transaction-days";
import { budgetHref, resolveCategoryFilter } from "@/lib/budget-url";
import { RECENT_CATEGORY_SAMPLE, recentCategoryIds } from "@/lib/recent-categories";
import type { ShareableHousehold } from "@/components/personal-budget/log-shared-expense-dialog";
import { PeriodSummary } from "@/components/budget/period-summary";
import { MonthAtAGlance } from "@/components/budget/month-at-a-glance";
import { previousCutoff, standOuts, totalsOf } from "@/lib/month-comparison";
import { SavingsGoals } from "@/components/budget/savings-goals";
import { savingsGoalRows } from "@/lib/savings-goal-calc";
import { categoriesNearLimit, withCategoryLimits } from "@/lib/budget-category-limit";
import { withCategoryRollover } from "@/lib/budget-rollover-calc";
import { SPEND_HISTORY_MONTHS, withSpendHistory } from "@/lib/chart-calc";
import {
  acknowledgePersonalTemplatePeriodAction,
  createPersonalRecurringTemplateAction,
  createPersonalTransactionAction,
  deletePersonalRecurringTemplateAction,
  deletePersonalTransactionAction,
  logPersonalRecurringTemplateAction,
  setPersonalBudgetMonthStartDayAction,
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
  addMonths,
  isMonthKey,
  parseMonthKey,
  periodBounds,
  periodKeyOf,
  toMonthKey,
} from "@/lib/budget-date-utils";
import { getPersonalBudgetStartDay } from "@/lib/personal-budget-period";
import { BudgetMonthSetting } from "@/components/budget/budget-month-setting";
import {
  createPersonalCategoryAction,
  createPersonalStarterCategoriesAction,
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
  currentMonthKey,
  startDay,
  now,
}: {
  userId: string;
  dict: Dictionary;
  locale: Locale;
  monthStart: Date;
  monthEnd: Date;
  monthKey: string;
  /** Today's period key, and the user's Personal Budget month start day
   * (User.personalBudgetMonthStartDay) the periods are cut by. */
  currentMonthKey: string;
  startDay: number;
  now: Date;
}) {
  // The fixed trend's first period, MAX_FIXED_TREND_MONTHS back from today's.
  const fixedTrendStart = periodBounds(
    toMonthKey(addMonths(parseMonthKey(currentMonthKey), -(MAX_FIXED_TREND_MONTHS - 1))),
    startDay,
  ).start;
  // Transactions, the shared-with-your-household mirror, totals and the
  // headline number all come from one loader shared with the dashboard's
  // "Your budget" card, so the two can't drift apart — see
  // src/lib/personal-budget-position.ts.
  const [categories, position, sharedTrendSplits, ownTrendTransactions, savedSums, latestTransactions] = await Promise.all([
    prisma.personalBudgetCategory.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    loadPersonalBudgetPosition({
      userId,
      monthStart,
      monthEnd,
      startDay,
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
          date: { gte: fixedTrendStart },
        },
      },
      select: {
        amountOwed: true,
        transaction: { select: { type: true, date: true, recurringTemplateId: true } },
      },
    }),
    // PERF-2: the user's own recurring-bill transactions for the same trend
    // window. The loader only reads a trailing window behind the viewed
    // month, which ends before today's when a past month is open, so the
    // trend has its own bounded query rather than the whole history.
    prisma.personalTransaction.findMany({
      where: { userId, recurringTemplateId: { not: null }, date: { gte: fixedTrendStart } },
      select: { type: true, amount: true, date: true, recurringTemplateId: true },
    }),
    // GAP-22: all-time savings per category, summed by the database (see
    // savedByCategory below).
    prisma.personalTransaction.groupBy({
      by: ["categoryId"],
      where: { userId, type: "SAVINGS" },
      _sum: { amount: true },
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
  } = position;

  const sharedCostsSummary = summarizeSharedCosts(sharedPostedRows, householdDebts);

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
  // splits: [] below — RecurringTemplateDialog's/RecurringTemplateList's
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
    transactions: ownTrendTransactions,
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
    startDay,
    sharedLabel: dict.personalBudget.shared.sharedBadge,
  });

  // --- Setup tab: bills & income, categories, budget month ------------------
  // Grouped together — see budget-tabs.tsx's doc comment (this mirrors the
  // household budget's own Manage tab).
  const manage = (
    <div className="flex flex-col gap-6">
      <BillsAndIncomePanel
        templates={recurringTemplateRows}
        pausedTemplates={pausedRecurringTemplateRows}
        plannedRows={plannedExpenseRows}
        categories={categoryRows}
        monthKey={monthKey}
        dict={dict.personalBudget}
        locale={locale}
        onTogglePause={setPersonalRecurringTemplateActiveAction}
        onDeleteTemplate={deletePersonalRecurringTemplateAction}
        onAcknowledge={acknowledgePersonalTemplatePeriodAction}
        onUnacknowledge={unacknowledgePersonalTemplatePeriodAction}
        createTemplateAction={createPersonalRecurringTemplateAction}
        updateTemplateAction={updatePersonalRecurringTemplateAction}
        createPlannedAction={createPersonalPlannedExpenseAction}
        updatePlannedAction={updatePersonalPlannedExpenseAction}
        onDeletePlanned={deletePersonalPlannedExpenseAction}
        createTransactionAction={createPersonalTransactionAction}
        updateTransactionAction={updatePersonalTransactionAction}
      />
      <CategoryManager
        categories={categoryRows}
        dict={dict.personalBudget}
        createAction={createPersonalCategoryAction}
        updateAction={updatePersonalCategoryAction}
        deleteAction={deletePersonalCategoryAction}
      />
      {/* Last: set once, rarely touched again. The personal budget is the
          user's alone, so anyone can change it (no owner gate). */}
      <BudgetMonthSetting
        id="personal-budget-month-start"
        startDay={startDay}
        canEdit
        action={setPersonalBudgetMonthStartDayAction}
        dict={dict.personalBudget.budgetMonth}
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
      lookbackTransactions,
      monthStart,
      startDay,
    ),
    lookbackTransactions,
    monthStart,
    "EXPENSE",
    SPEND_HISTORY_MONTHS,
    startDay,
    // "vs usual" up to the same day — see the household page.
    now,
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
      incomeByCategory={incomeByCategory}
      // GAP-12 — see the household page's identical comment. The
      // shared-household mirror rows (`shared:` ids) never match a
      // personal category, so they keep their plain proportional bar.
      // GAP-21: the carried balance (at most back to January — see
      // src/lib/budget-rollover-calc.ts) and UX-39's "vs usual" history both
      // read the loader's 12-month trailing window, so they need no extra query.
      expenseByCategory={expenseRows}
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

  // GAP-22 — see the household page's identical card. Each category's
  // all-time savings, summed by the database (savedSums above) now that the
  // loader no longer holds the whole history. Only the user's own
  // PersonalTransactions (the shared-household mirror is kept separately), so
  // nothing household-side counts towards a personal goal.
  const savedByCategory = new Map<string, number>(savedSums.map((r) => [r.categoryId, r._sum.amount ?? 0]));
  // "{Month} at a glance", leading Insights — see the household page's
  // identical card. This month's totals already include the user's share of
  // shared household bills (the loader's sharedPostedRows), so last month's
  // do too: one more query for those shares, cut at the same day.
  const previousPeriod = periodBounds(toMonthKey(addMonths(parseMonthKey(monthKey), -1)), startDay);
  const cutoff = previousCutoff({ current: { start: monthStart, end: monthEnd }, previous: previousPeriod, today: now });
  const previousSharedShares =
    memberships.length > 0
      ? await prisma.transactionSplit.findMany({
          where: {
            householdMemberId: { in: memberships.map((m) => m.id) },
            transaction: { date: { gte: previousPeriod.start, lt: cutoff.end } },
          },
          select: { amountOwed: true, transaction: { select: { type: true } } },
        })
      : [];
  const monthNameFormat = new Intl.DateTimeFormat(locale, { month: "long" });
  const glance = (
    <MonthAtAGlance
      current={{ income, expense, savings, left: income - expense - savings }}
      previous={totalsOf([
        ...lookbackTransactions.filter((t) => t.date >= previousPeriod.start && t.date < cutoff.end),
        ...previousSharedShares.map((s) => ({ type: s.transaction.type, amount: s.amountOwed })),
      ])}
      partial={cutoff.partial}
      monthName={monthNameFormat.format(parseMonthKey(monthKey))}
      previousMonthName={monthNameFormat.format(addMonths(parseMonthKey(monthKey), -1))}
      standOuts={standOuts(expenseRows)}
      dict={dict.personalBudget.glance}
      locale={locale}
    />
  );

  const savingsGoals = (
    <SavingsGoals
      goals={savingsGoalRows(categories, savedByCategory, now)}
      dict={dict.personalBudget.savingsGoals}
      locale={locale}
    />
  );

  const insights = (
    <div className="flex flex-col gap-6">
      {glance}
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
    <LazyDialogErrorMessage message={dict.errors.generic}>
      <BudgetTabs
        dict={dict.personalBudget}
        locale={locale}
        monthKey={monthKey}
        currentMonthKey={currentMonthKey}
        budgetMonthStartDay={startDay}
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
        hasRecurringTemplates={recurringTemplates.some((t) => t.active)}
        hadRecurringTemplatesInMonth={recurringTemplateRows.length > 0}
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
          <BudgetOnboarding
            dict={dict.personalBudget}
            body={dict.personalBudget.onboarding.body}
            createCategoryAction={createPersonalCategoryAction}
            createStarterCategoriesAction={createPersonalStarterCategoriesAction}
          />
        }
        sharedCosts={
          sharedCostsSummary.hasAny ? (
            <SharedCostsCard
              summary={sharedCostsSummary}
              debts={householdDebts}
              showHouseholdName={showHouseholdName}
              transactionsHref={budgetHref("/dashboard/personal-budget", { month: monthKey, tab: "transactions" })}
              monthLabel={
                monthKey === currentMonthKey
                  ? undefined
                  : parseMonthKey(monthKey).toLocaleDateString(locale, { month: "long", year: "numeric" })
              }
              dict={dict.personalBudget}
              locale={locale}
            />
          ) : null
        }
        manage={manage}
        transactions={transactionsTab}
        insights={insights}
      />
    </LazyDialogErrorMessage>
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
  // The user's own budget month start day: same period rules as the
  // household budget's (UX-134), named for the month a period ends in (day
  // 25: "October" is 25 Sep to 24 Oct), but the user's choice, not any
  // household's.
  const startDay = await getPersonalBudgetStartDay(userId);
  const currentMonthKey = periodKeyOf(now, startDay);
  const monthKey = isMonthKey(monthParamValue) ? monthParamValue : currentMonthKey;
  const { start: monthStart, end: monthEnd } = periodBounds(monthKey, startDay);

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
          currentMonthKey={currentMonthKey}
          startDay={startDay}
          now={now}
        />
      </Suspense>
    </div>
  );
}
