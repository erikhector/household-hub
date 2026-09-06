import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { PersonalCategoryManager } from "@/components/personal-budget/personal-category-manager";
import { PersonalTransactionDialog } from "@/components/personal-budget/personal-transaction-dialog";
import { PersonalTransactionList } from "@/components/personal-budget/personal-transaction-list";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { computeSafeToSpend } from "@/app/dashboard/budget/safe-to-spend-calc";

export default async function PersonalBudgetPage() {
  const [userId, dict, locale] = await Promise.all([
    requireUserId(),
    getDictionary(),
    getLocale(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [categories, transactions] = await Promise.all([
    prisma.personalBudgetCategory.findMany({
      where: { userId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.personalTransaction.findMany({
      where: { userId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { category: true },
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

  const totalsByCategory = (type: "INCOME" | "EXPENSE"): CategoryTotal[] => {
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
  const income = incomeByCategory.reduce((sum, c) => sum + c.total, 0);
  const expense = expenseByCategory.reduce((sum, c) => sum + c.total, 0);

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.personalBudget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.personalBudget.subtitle}</p>
      </div>

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
        incomeByCategory={incomeByCategory}
        expenseByCategory={expenseByCategory}
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
}
