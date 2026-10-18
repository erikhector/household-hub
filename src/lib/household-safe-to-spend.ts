// The household budget's "safe to spend" number for the current month, for
// the overview's Today block (UX-70). The budget page computes the same
// number inline from data it already loads for its tabs; this loads only
// what the number needs (this month and the 12-month lookback's
// transactions, active recurring templates with their acknowledgements, and
// planned bills) and feeds the very same pure calculators, so the two
// places agree. If the inputs below change in
// src/app/dashboard/budget/page.tsx, change them here too.

import { prisma } from "@/lib/prisma";
import { addMonths, getMonthEnd, getMonthStart } from "@/lib/budget-date-utils";
import { computeTemplateStatuses } from "@/lib/recurring-template-calc";
import { getPlannedExpenseStatus } from "@/lib/planned-expense-calc";
import { computeSafeToSpend, type SafeToSpendStatus } from "@/lib/safe-to-spend-calc";

// Same window as RECURRING_LOOKBACK_MONTHS in the budget page: how far back
// the calculator looks for a category's latest recurring transaction.
const RECURRING_LOOKBACK_MONTHS = 12;

export async function loadHouseholdSafeToSpend(
  householdId: string,
  now: Date = new Date(),
): Promise<{ amount: number; status: SafeToSpendStatus }> {
  const monthStart = getMonthStart(now);
  const monthEnd = getMonthEnd(monthStart);
  const lookbackStart = addMonths(monthStart, -RECURRING_LOOKBACK_MONTHS);

  const [transactions, templates, acks, plannedExpenses] = await Promise.all([
    prisma.transaction.findMany({
      where: { householdId, date: { gte: lookbackStart, lt: monthEnd } },
      select: {
        categoryId: true,
        category: { select: { name: true } },
        type: true,
        amount: true,
        date: true,
        isRecurring: true,
        recurringTemplateId: true,
      },
    }),
    prisma.recurringTemplate.findMany({ where: { householdId, active: true } }),
    prisma.recurringTemplateAck.findMany({ where: { recurringTemplate: { householdId } } }),
    prisma.plannedExpense.findMany({
      where: {
        householdId,
        OR: [{ transaction: { is: null } }, { transaction: { is: { date: { gte: monthStart } } } }],
      },
      select: {
        id: true,
        name: true,
        amount: true,
        dueDate: true,
        transaction: { select: { date: true } },
      },
    }),
  ]);

  const sumThisMonth = (type: "INCOME" | "EXPENSE" | "SAVINGS") =>
    transactions
      .filter((t) => t.type === type && t.date >= monthStart && t.date < monthEnd)
      .reduce((sum, t) => sum + t.amount, 0);

  const templateStatusRows = computeTemplateStatuses({
    templates,
    transactions: transactions.map((t) => ({ recurringTemplateId: t.recurringTemplateId, date: t.date })),
    acks,
    referenceDate: monthStart,
    monthEnd,
  });

  const { safeToSpend, status } = computeSafeToSpend({
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
    incomeSoFar: sumThisMonth("INCOME"),
    expenseSoFar: sumThisMonth("EXPENSE"),
    savingsSoFar: sumThisMonth("SAVINGS"),
    templates: templateStatusRows.map((row) => ({
      id: row.template.id,
      name: row.template.name,
      categoryId: row.template.categoryId,
      type: row.template.type,
      amount: row.template.amount,
      status: row.status,
    })),
    plannedExpenses: plannedExpenses.map((p) => ({
      id: p.id,
      name: p.name,
      amount: p.amount,
      status: getPlannedExpenseStatus(
        { dueDate: p.dueDate, paidAt: p.transaction?.date ?? null },
        monthStart,
        monthEnd,
      ),
    })),
  });

  return { amount: safeToSpend, status };
}
