// The household budget's "safe to spend" number for the current month, for
// the overview's Today block (UX-70). The budget page computes the same
// number inline from data it already loads for its tabs; this loads only
// what the number needs (this month and the 12-month lookback's
// transactions, active recurring templates with their acknowledgements, and
// planned bills) and feeds the very same pure calculators, so the two
// places agree. If the inputs below change in
// src/app/dashboard/budget/page.tsx, change them here too.

import { prisma } from "@/lib/prisma";
import { addMonths, normalizeStartDay, parseMonthKey, periodBounds, periodKeyOf, toMonthKey } from "@/lib/budget-date-utils";
import { computeTemplateStatuses } from "@/lib/recurring-template-calc";
import { getPlannedExpenseStatus, plannedItemType } from "@/lib/planned-expense-calc";
import { categoryEnvelopes } from "@/lib/budget-category-limit";
import { computeSafeToSpend, type SafeToSpendStatus } from "@/lib/safe-to-spend-calc";

// Same window as RECURRING_LOOKBACK_MONTHS in the budget page: how far back
// the calculator looks for a category's latest recurring transaction.
const RECURRING_LOOKBACK_MONTHS = 12;

/**
 * `budgetMonthStartDay` is the household's (UX-134): the number is for the
 * budget period `now` falls in, 25 Sep to 24 Oct when the month starts on the
 * 25th. Left out it is the calendar month.
 */
export async function loadHouseholdSafeToSpend(
  householdId: string,
  now: Date = new Date(),
  budgetMonthStartDay?: number,
): Promise<{ amount: number; status: SafeToSpendStatus }> {
  const startDay = normalizeStartDay(budgetMonthStartDay);
  const monthKey = periodKeyOf(now, startDay);
  const { start: monthStart, end: monthEnd } = periodBounds(monthKey, startDay);
  const lookbackStart = periodBounds(
    toMonthKey(addMonths(parseMonthKey(monthKey), -RECURRING_LOOKBACK_MONTHS)),
    startDay,
  ).start;

  const [transactions, templates, acks, plannedExpenses, categories] = await Promise.all([
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
        categoryId: true,
        category: { select: { type: true } },
        transaction: { select: { date: true } },
      },
    }),
    // UX-138: the limited categories, whose unspent remainder is held back.
    prisma.budgetCategory.findMany({
      where: { householdId, type: "EXPENSE", monthlyLimit: { not: null } },
      select: { id: true, type: true, monthlyLimit: true, rolloverEnabled: true, createdAt: true },
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
    startDay,
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
    categoryLimits: categoryEnvelopes({ categories, transactions, monthStart, monthEnd, startDay }),
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
      categoryId: p.categoryId,
      type: plannedItemType(p.category.type),
      status: getPlannedExpenseStatus(
        { dueDate: p.dueDate, paidAt: p.transaction?.date ?? null },
        monthStart,
        monthEnd,
      ),
    })),
  });

  return { amount: safeToSpend, status };
}
