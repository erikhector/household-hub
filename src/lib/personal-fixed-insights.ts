// Personal Budget's "Fixed income & costs" card (Insights tab), including the
// user's share of split household bills (BUDGET-7). The month totals,
// per-category bars and safe-to-spend already count those shares (see
// src/lib/personal-budget-position.ts); before this the fixed card was built
// from the user's own PersonalRecurringTemplates alone, so half the rent was
// missing from the planned costs, the breakdown, the 12-month trend and the
// balanced/tight/deficit status.
//
// Pure, like recurring-template-calc.ts which it wraps: the shared rows go
// through the very same calcs as the personal ones, already reduced to the
// user's own share (their `amountOwed`, never a bill's full amount), so the
// shared side can't drift from the personal side's rules (active flag,
// createdAt cutoff, monthly equivalents).

import {
  computeBudgetBalanceStatus,
  computeFixedMonthlySummary,
  computeRecurringBreakdown,
  computeRecurringMonthlyTotals,
  type BudgetBalanceStatus,
  type FixedItemType,
  type FixedMonthlySummary,
  type RecurringBreakdownInput,
  type RecurringMonthlyTotals,
  type RecurringMonthlyTotalsInput,
} from "@/lib/recurring-template-calc";

export type PersonalFixedInsightsInput = {
  /** The user's own PersonalRecurringTemplates. */
  templates: RecurringBreakdownInput[];
  /** The user's own PersonalTransactions. */
  transactions: RecurringMonthlyTotalsInput[];
  /** Shared household RecurringTemplates, `amount` already the user's share. */
  sharedTemplates: RecurringBreakdownInput[];
  /** The user's split shares of household bills, `amount` = their amountOwed. */
  sharedTransactions: RecurringMonthlyTotalsInput[];
  monthEnd: Date;
  /** The trend's last month — today, like the household budget's. */
  referenceDate: Date;
  monthsBack: number;
  /** The user's Personal Budget month start day: the trend's buckets are
   * its periods (see computeRecurringMonthlyTotals). Defaults to 1. */
  startDay?: number;
  /** dict.personalBudget.shared.sharedBadge, same label PeriodSummary uses. */
  sharedLabel: string;
};

export type PersonalFixedInsights = {
  summary: FixedMonthlySummary;
  monthlyTotals: RecurringMonthlyTotals[];
  incomeBreakdown: { id: string; name: string; total: number }[];
  expenseBreakdown: { id: string; name: string; total: number }[];
  balanceStatus: BudgetBalanceStatus;
};

export function computePersonalFixedInsights({
  templates,
  transactions,
  sharedTemplates,
  sharedTransactions,
  monthEnd,
  referenceDate,
  monthsBack,
  startDay = 1,
  sharedLabel,
}: PersonalFixedInsightsInput): PersonalFixedInsights {
  // Keyed and labelled apart from the user's own items, the same way the
  // loader's shared category totals are, so a personal "Rent" and a shared
  // "Rent" stay two rows.
  const allTemplates = [
    ...templates,
    ...sharedTemplates.map((t) => ({ ...t, id: `shared:${t.id}`, name: `${t.name} (${sharedLabel})` })),
  ];
  const summary = computeFixedMonthlySummary(allTemplates, monthEnd);
  const breakdown = (type: FixedItemType) =>
    computeRecurringBreakdown(allTemplates, type, monthEnd).map((item) => ({
      id: item.id,
      name: item.name,
      total: item.monthlyAmount,
    }));
  return {
    summary,
    monthlyTotals: computeRecurringMonthlyTotals({
      transactions: [...transactions, ...sharedTransactions],
      referenceDate,
      monthsBack,
      startDay,
    }),
    incomeBreakdown: breakdown("INCOME"),
    expenseBreakdown: breakdown("EXPENSE"),
    balanceStatus: computeBudgetBalanceStatus(summary),
  };
}
