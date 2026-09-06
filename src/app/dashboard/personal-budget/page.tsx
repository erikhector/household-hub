import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { PersonalBudgetTabs } from "@/components/personal-budget/personal-budget-tabs";
import { PersonalCategoryManager } from "@/components/personal-budget/personal-category-manager";
import {
  PersonalRecurringTemplatesPanel,
  type PausedPersonalRecurringTemplateRow,
  type PersonalRecurringTemplateListRow,
} from "@/components/personal-budget/personal-recurring-templates-panel";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import { PersonalTransactionList } from "@/components/personal-budget/personal-transaction-list";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import {
  computeFixedMonthlySummary,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
} from "@/app/dashboard/budget/recurring-template-calc";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { computeSafeToSpend } from "@/app/dashboard/budget/safe-to-spend-calc";

// Same cap as the household budget's cost analyzer / fixed trend chart.
const MAX_FIXED_TREND_MONTHS = 12;

export default async function PersonalBudgetPage() {
  const [userId, dict, locale] = await Promise.all([
    requireUserId(),
    getDictionary(),
    getLocale(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

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
    // recurring-template-calc.ts.
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

  const transactionRows = transactions.map((t) => ({
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

  const monthTransactions = transactions.filter((t) => t.date >= monthStart && t.date < monthEnd);

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
  // safe-to-spend-calc.ts — fed this user's own transactions instead.
  const { safeToSpend, expectedRecurring } = computeSafeToSpend({
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
  });

  // --- Recurring templates --------------------------------------------------
  // Mirrors the household budget's (src/app/dashboard/budget/page.tsx) —
  // see recurring-template-calc.ts's doc comments.
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
    referenceDate: now,
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
  // recurring-template-calc.ts's doc comments.
  const fixedMonthlySummary = computeFixedMonthlySummary(recurringTemplates);
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

  const overview = (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <PersonalTransactionDialog
          dict={dict.personalBudget}
          categories={categoryRows}
          trigger={
            <Button disabled={categoryRows.length === 0}>{dict.personalBudget.addTransaction}</Button>
          }
        />
      </div>

      {categoryRows.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {dict.personalBudget.noCategoriesWarning}
        </p>
      )}

      <SafeToSpend
        amount={safeToSpend}
        expectedRecurring={expectedRecurring}
        dict={dict.personalBudget.safeToSpend}
        locale={locale}
      />

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

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <PersonalTransactionList
          transactions={transactionRows}
          categories={categoryRows}
          dict={dict.personalBudget}
          locale={locale}
        />
        <PersonalCategoryManager categories={categoryRows} dict={dict.personalBudget} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.personalBudget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.personalBudget.subtitle}</p>
      </div>

      <PersonalBudgetTabs
        dict={dict.personalBudget}
        overview={overview}
        fixed={
          <div className="flex flex-col gap-6">
            <FixedBudgetSummary
              monthlyIncome={fixedMonthlySummary.monthlyIncome}
              monthlyExpense={fixedMonthlySummary.monthlyExpense}
              monthlySavings={fixedMonthlySummary.monthlySavings}
              monthlyTotals={fixedMonthlyTotals}
              dict={dict.personalBudget.fixedSummary}
              locale={locale}
            />
            <PersonalRecurringTemplatesPanel
              templates={recurringTemplateRows}
              pausedTemplates={pausedRecurringTemplateRows}
              categories={categoryRows}
              dict={dict.personalBudget}
              locale={locale}
            />
          </div>
        }
      />
    </div>
  );
}
