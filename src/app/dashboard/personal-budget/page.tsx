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
import { TransactionList } from "@/components/budget/transaction-list";
import type { ShareableHousehold } from "@/components/personal-budget/log-shared-expense-dialog";
import { PeriodSummary } from "@/components/budget/period-summary";
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
  computeBudgetBalanceStatus,
  computeFixedMonthlySummary,
  computeRecurringBreakdown,
  computeRecurringMonthlyTotals,
} from "@/lib/recurring-template-calc";
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
  const [categories, position] = await Promise.all([
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
  ]);
  const {
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
  } = position;

  const categoryRows = categories.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  // Households the user can log a shared expense into directly from this
  // page (LogSharedExpenseDialog) — the entry-point half of the personal
  // ↔ household link, complementing the read-only mirror in the loader
  // above. Only households with more than one member qualify (nothing to
  // split otherwise), same gating TransactionDialog uses for its own split UI.
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
      <div className="flex justify-end">
        <ExportButton href="/dashboard/personal-budget/export" label={dict.export.button} />
      </div>
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
        onDelete={deletePersonalTransactionAction}
        createAction={createPersonalTransactionAction}
        updateAction={updatePersonalTransactionAction}
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
      remaining={safeToSpend}
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
    <BudgetTabs
      dict={dict.personalBudget}
      locale={locale}
      monthKey={monthKey}
      basePath="/dashboard/personal-budget"
      categories={categoryRows}
      safeToSpendAmount={safeToSpend}
      safeToSpendStatus={safeToSpendStatus}
      safeToSpendBreakdown={safeToSpendBreakdown}
      safeToSpendExpectedRecurring={expectedRecurring}
      householdDebts={householdDebts}
      dueTemplates={recurringTemplateRows.filter((r) => r.status === "due")}
      hasRecurringTemplates={recurringTemplateRows.length > 0}
      sharedDueRows={sharedDueRows}
      showHouseholdName={showHouseholdName}
      sharedExpenseHouseholds={sharedExpenseHouseholds}
      logSharedDialogDict={dict.personalBudget}
      createTransactionAction={createPersonalTransactionAction}
      updateTransactionAction={updatePersonalTransactionAction}
      onAcknowledgeTemplate={acknowledgePersonalTemplatePeriodAction}
      onLogTemplateAsIs={logPersonalRecurringTemplateAction}
      periodSummary={periodSummary}
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
function PersonalBudgetTabsSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" role="status" aria-label="Loading">
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
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.personalBudget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.personalBudget.subtitle}</p>
      </div>

      <Suspense fallback={<PersonalBudgetTabsSkeleton />}>
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
