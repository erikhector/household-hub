import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { PersonalBudgetTabs } from "@/components/personal-budget/personal-budget-tabs";
import { PersonalCategoryManager } from "@/components/personal-budget/personal-category-manager";
import {
  PersonalRecurringTemplatesPanel,
  type PausedPersonalRecurringTemplateRow,
  type PersonalRecurringTemplateListRow,
} from "@/components/personal-budget/personal-recurring-templates-panel";
import { PersonalTransactionList } from "@/components/personal-budget/personal-transaction-list";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import {
  computeFixedMonthlySummary,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
} from "@/lib/recurring-template-calc";
import { computeSafeToSpend } from "@/lib/safe-to-spend-calc";
import {
  getMonthEnd,
  getMonthStart,
  isMonthKey,
  parseMonthKey,
  toMonthKey,
} from "@/lib/budget-date-utils";

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

  const totalsByCategory = (type: "INCOME" | "EXPENSE" | "SAVINGS"): CategoryTotal[] => {
    const totals = new Map<string, CategoryTotal>();
    for (const t of monthTransactions) {
      if (t.type !== type) continue;
      const existing = totals.get(t.categoryId);
      if (existing) {
        existing.total += t.amount;
      } else {
        totals.set(t.categoryId, { id: t.categoryId, name: t.category.name, total: t.amount });
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
  const { safeToSpend, expectedRecurring, status: safeToSpendStatus } = computeSafeToSpend({
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

  // --- Manage tab: recurring items + categories -----------------------------
  // Grouped together — see budget-tabs.tsx's doc comment (this mirrors the
  // household budget's own Manage tab).
  const manage = (
    <div className="flex flex-col gap-6">
      <PersonalRecurringTemplatesPanel
        templates={recurringTemplateRows}
        pausedTemplates={pausedRecurringTemplateRows}
        categories={categoryRows}
        dict={dict.personalBudget}
        locale={locale}
      />
      <PersonalCategoryManager categories={categoryRows} dict={dict.personalBudget} />
    </div>
  );

  const transactionsTab = (
    <PersonalTransactionList
      transactions={transactionRows}
      categories={categoryRows}
      dict={dict.personalBudget}
      locale={locale}
    />
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
        periodSummary={periodSummary}
        manage={manage}
        transactions={transactionsTab}
        insights={insights}
      />
    </div>
  );
}
