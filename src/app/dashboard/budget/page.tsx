import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { CategoryManager } from "@/components/budget/category-manager";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import { TransactionDialog } from "@/components/budget/transaction-dialog";
import { TransactionList } from "@/components/budget/transaction-list";

export default async function BudgetPage() {
  const [{ household }, dict, locale] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [categories, transactions] = await Promise.all([
    prisma.budgetCategory.findMany({
      where: { householdId: household.id },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { householdId: household.id },
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.budget.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.budget.subtitle}</p>
        </div>
        <TransactionDialog
          dict={dict.budget}
          categories={categoryRows}
          trigger={
            <Button disabled={categoryRows.length === 0}>{dict.budget.addTransaction}</Button>
          }
        />
      </div>

      {categoryRows.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {dict.budget.noCategoriesWarning}
        </p>
      )}

      <PeriodSummary
        income={income}
        expense={expense}
        incomeByCategory={incomeByCategory}
        expenseByCategory={expenseByCategory}
        dict={dict.budget}
        locale={locale}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <TransactionList
          transactions={transactionRows}
          categories={categoryRows}
          dict={dict.budget}
          locale={locale}
        />
        <CategoryManager categories={categoryRows} dict={dict.budget} />
      </div>
    </div>
  );
}
