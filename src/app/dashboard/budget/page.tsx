import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/export/export-button";
import { BudgetTabs } from "@/components/budget/budget-tabs";
import { CategoryManager } from "@/components/budget/category-manager";
import {
  CostAnalyzer,
  type ItemPriceTrend,
  type MonthlySpendPoint,
} from "@/components/budget/cost-analyzer";
import { FixedBudgetSummary } from "@/components/budget/fixed-budget-summary";
import { HouseholdBalances } from "@/components/budget/household-balances";
import { PeriodSummary, type CategoryTotal } from "@/components/budget/period-summary";
import {
  RecurringTemplatesPanel,
  type PausedRecurringTemplateRow,
  type RecurringTemplateListRow,
} from "@/components/budget/recurring-templates-panel";
import { SafeToSpend } from "@/components/budget/safe-to-spend";
import { TransactionDialog } from "@/components/budget/transaction-dialog";
import { TransactionList } from "@/components/budget/transaction-list";
import { computeSafeToSpend } from "./safe-to-spend-calc";
import {
  computeFixedMonthlySummary,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
} from "./recurring-template-calc";
import { computeNetBalances, simplifyDebts } from "./settle-up-calc";

// An item needs at least this many recorded prices before its trend is
// considered meaningful enough to show — see REQUIREMENTS.md's "Cost
// analyzer" subsection.
const MIN_PRICE_POINTS_FOR_TREND = 3;
// Cap the monthly spending chart to the most recent N months so it stays
// readable once a household has years of price history.
const MAX_SPENDING_MONTHS = 12;
// Same cap, for the "Fixed income & costs" trend chart.
const MAX_FIXED_TREND_MONTHS = 12;

export default async function BudgetPage() {
  const [{ household, userId }, dict, locale] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [categories, transactions, householdMembers, recurringTemplates, recurringTemplateAcks] =
    await Promise.all([
      prisma.budgetCategory.findMany({
        where: { householdId: household.id },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
      prisma.transaction.findMany({
        where: { householdId: household.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        include: { category: true, splits: true },
      }),
      // Fetched for the expense-splitting feature (see REQUIREMENTS.md's
      // "Household expense splitting" subsection) — the split UI and the
      // balances tab are both only offered when a household has more than
      // one member.
      prisma.householdMember.findMany({
        where: { householdId: household.id },
        include: { user: { select: { displayName: true } } },
        orderBy: { createdAt: "asc" },
      }),
      // Recurring bill templates — see recurring-template-calc.ts and the
      // "Recurring" tab below.
      prisma.recurringTemplate.findMany({
        where: { householdId: household.id },
        include: { category: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.recurringTemplateAck.findMany({
        where: { recurringTemplate: { householdId: household.id } },
      }),
    ]);

  const categoryRows = categories.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  const memberOptions = householdMembers.map((m) => ({ id: m.id, displayName: m.user.displayName }));
  const currentMemberId = householdMembers.find((m) => m.userId === userId)?.id ?? "";

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
    paidByMemberId: t.paidByMemberId,
    splits: t.splits.map((s) => ({ householdMemberId: s.householdMemberId, amountOwed: s.amountOwed })),
  }));

  // --- Household expense splitting: "who owes whom" -----------------------
  // See REQUIREMENTS.md's "Household expense splitting" subsection. Only
  // meaningful once a household has more than one member; all netting/
  // debt-simplification logic lives in settle-up-calc.ts so it's
  // unit-testable without Prisma, same convention as safe-to-spend-calc.ts.
  const settlements =
    memberOptions.length > 1
      ? simplifyDebts(
          computeNetBalances(
            transactions
              .filter((t) => t.paidByMemberId && t.splits.length > 0)
              .map((t) => ({
                amount: t.amount,
                paidByMemberId: t.paidByMemberId as string,
                splits: t.splits.map((s) => ({
                  householdMemberId: s.householdMemberId,
                  amountOwed: s.amountOwed,
                })),
              })),
          ),
        )
      : [];

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
  // Neither income nor a cost (see TransactionType's doc comment in
  // schema.prisma) — tracked separately rather than folded into income or
  // expense below.
  const savingsByCategory = totalsByCategory("SAVINGS");
  const income = incomeByCategory.reduce((sum, c) => sum + c.total, 0);
  const expense = expenseByCategory.reduce((sum, c) => sum + c.total, 0);
  const savings = savingsByCategory.reduce((sum, c) => sum + c.total, 0);

  // --- Safe to spend --------------------------------------------------------
  // See REQUIREMENTS.md's "Safe to spend" subsection: this month's income so
  // far minus expenses so far, minus an estimate of recurring expense
  // categories that haven't posted a transaction yet this month. All pure
  // logic lives in computeSafeToSpend (./safe-to-spend-calc.ts) so it's
  // unit-testable without Prisma; this just feeds it the transactions the
  // page already fetched above.
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
  // See recurring-template-calc.ts's doc comments for the "accounted for"
  // model. Paused (inactive) templates get their own section in the panel
  // instead of a status, since "due/acknowledged/posted" is meaningless
  // while a template isn't running.
  const activeRecurringTemplates = recurringTemplates.filter((t) => t.active);
  const templateStatusRows = computeTemplateStatuses({
    templates: activeRecurringTemplates,
    transactions: transactions.map((t) => ({
      recurringTemplateId: t.recurringTemplateId,
      date: t.date,
    })),
    acks: recurringTemplateAcks,
    referenceDate: now,
  });
  const recurringTemplateRows: RecurringTemplateListRow[] = templateStatusRows.map((row) => ({
    id: row.template.id,
    name: row.template.name,
    categoryId: row.template.categoryId,
    categoryName: row.template.category.name,
    amount: row.template.amount,
    frequency: row.template.frequency,
    dayOfMonth: row.template.dayOfMonth,
    status: row.status,
  }));
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
    }));

  // --- Fixed income & costs summary -----------------------------------------
  // The "core of the budget" headline — see computeFixedMonthlySummary's doc
  // comment. Fed every template (active and paused; the calc filters active
  // itself) rather than just activeRecurringTemplates, so it stays symmetric
  // with computeTemplateStatuses's own internal filtering above.
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

  // --- Cost analyzer aggregation ------------------------------------------
  // Fed from PriceHistory, populated whenever a shopping list item is marked
  // purchased with an estimated price (togglePurchasedAction in
  // src/app/dashboard/shopping-list/actions.ts). All aggregation happens
  // here in the page's Server Component, same convention as the period
  // summary above — CostAnalyzer itself is a plain presentational component.
  const priceHistoryRows = await prisma.priceHistory.findMany({
    where: { inventoryItem: { householdId: household.id } },
    include: { inventoryItem: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });

  const monthlyTotals = new Map<string, number>();
  for (const row of priceHistoryRows) {
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
    monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + row.price);
  }
  const monthlySpending: MonthlySpendPoint[] = [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-MAX_SPENDING_MONTHS)
    .map(([month, total]) => ({ month, total }));

  const pointsByItem = new Map<string, ItemPriceTrend>();
  for (const row of priceHistoryRows) {
    const point = { date: row.date, price: row.price };
    const existing = pointsByItem.get(row.inventoryItemId);
    if (existing) {
      existing.points.push(point);
    } else {
      pointsByItem.set(row.inventoryItemId, {
        id: row.inventoryItemId,
        name: row.inventoryItem.name,
        points: [point],
        changePercent: 0,
      });
    }
  }
  const itemTrends: ItemPriceTrend[] = [...pointsByItem.values()]
    .filter((item) => item.points.length >= MIN_PRICE_POINTS_FOR_TREND)
    .map((item) => {
      const first = item.points[0].price;
      const last = item.points[item.points.length - 1].price;
      const changePercent = first === 0 ? 0 : ((last - first) / first) * 100;
      return { ...item, changePercent };
    })
    .sort((a, b) => b.points.length - a.points.length);

  const overview = (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end gap-2">
        <ExportButton href="/dashboard/budget/export" label={dict.export.button} />
        <TransactionDialog
          dict={dict.budget}
          categories={categoryRows}
          members={memberOptions}
          currentMemberId={currentMemberId}
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

      <SafeToSpend
        amount={safeToSpend}
        expectedRecurring={expectedRecurring}
        dict={dict.budget.safeToSpend}
        locale={locale}
      />

      <PeriodSummary
        income={income}
        expense={expense}
        savings={savings}
        incomeByCategory={incomeByCategory}
        expenseByCategory={expenseByCategory}
        savingsByCategory={savingsByCategory}
        dict={dict.budget.summary}
        locale={locale}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <TransactionList
          transactions={transactionRows}
          categories={categoryRows}
          members={memberOptions}
          currentMemberId={currentMemberId}
          dict={dict.budget}
          locale={locale}
        />
        <CategoryManager categories={categoryRows} dict={dict.budget} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.budget.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.budget.subtitle}</p>
      </div>

      <BudgetTabs
        dict={dict.budget}
        overview={overview}
        costAnalyzer={
          <CostAnalyzer
            monthlySpending={monthlySpending}
            itemTrends={itemTrends}
            dict={dict.budget.costAnalyzer}
            locale={locale}
          />
        }
        balances={
          memberOptions.length > 1 ? (
            <HouseholdBalances
              settlements={settlements}
              members={memberOptions}
              dict={dict.budget.balances}
              locale={locale}
            />
          ) : undefined
        }
        fixed={
          <div className="flex flex-col gap-6">
            <FixedBudgetSummary
              monthlyIncome={fixedMonthlySummary.monthlyIncome}
              monthlyExpense={fixedMonthlySummary.monthlyExpense}
              monthlySavings={fixedMonthlySummary.monthlySavings}
              monthlyTotals={fixedMonthlyTotals}
              dict={dict.budget.fixedSummary}
              locale={locale}
            />
            <RecurringTemplatesPanel
              templates={recurringTemplateRows}
              pausedTemplates={pausedRecurringTemplateRows}
              categories={categoryRows}
              members={memberOptions}
              currentMemberId={currentMemberId}
              dict={dict.budget}
              locale={locale}
            />
          </div>
        }
      />
    </div>
  );
}
