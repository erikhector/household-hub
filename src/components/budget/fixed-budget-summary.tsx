// The "Fixed income & costs" headline: the recurring income/costs/savings a
// household (or person) can plan for in advance, plus how the logged side of
// that has trended month to month, and a "is this in balance" status derived by
// computeBudgetBalanceStatus (src/lib/recurring-template-calc.ts). Pure
// presentational, fed pre-aggregated numbers from the page's Server
// Component — same convention as PeriodSummary/CostAnalyzer. Narrowed to the
// "fixedSummary" dictionary slice (rather than the full budget dictionary)
// so it can be reused for the personal budget too, same trick PeriodSummary
// already uses.
//
// UX-39: the trend is the shared BarChart (src/components/charts/): tap a
// month to read its income, costs and savings.
//
// Budget redesign (Oct 2026): one card — a sentence with the monthly numbers
// and whether they leave room, then the trend, with the items behind it
// folded away. It used to be four stat cards, the two "recurring
// income/costs" breakdowns open and the chart, about two phone screens on its
// own. The breakdowns stay one tap away rather than going: on Personal
// Budget they're the one place the user's share of each shared household
// bill is listed (BUDGET-7).

import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { BudgetBalanceStatus } from "@/lib/recurring-template-calc";
import { format } from "@/lib/i18n/format";
import { createMoneyFormat } from "@/lib/currency";
import { BarChart } from "@/components/charts/bar-chart";

export type FixedMonthlyTotals = { month: string; income: number; expense: number; savings: number };

// Same calmer three-way read as SafeToSpend's STATUS_COLOR
// (src/components/budget/safe-to-spend.tsx) — a tight-but-not-negative net
// gets its own amber tone rather than being lumped in with either a
// comfortably balanced or a truly in-deficit budget.
const STATUS_COLOR: Record<BudgetBalanceStatus, string> = {
  balanced: "text-success",
  tight: "text-warning",
  deficit: "text-destructive",
};

export function FixedBudgetSummary({
  monthlyIncome,
  monthlyExpense,
  monthlySavings,
  monthlyTotals,
  balanceStatus,
  incomeBreakdown,
  expenseBreakdown,
  dict,
  locale,
  currencyCode,
}: {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlySavings: number;
  monthlyTotals: FixedMonthlyTotals[];
  balanceStatus: BudgetBalanceStatus;
  incomeBreakdown: CategoryTotal[];
  expenseBreakdown: CategoryTotal[];
  dict: Dictionary["budget"]["fixedSummary"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  const netFixed = monthlyIncome - monthlyExpense;
  const hasTrendData = monthlyTotals.some((m) => m.income > 0 || m.expense > 0 || m.savings > 0);
  // DESIGN.md: status is tinted text plus an icon and words, never colour
  // alone.
  const StatusIcon = balanceStatus === "balanced" ? CheckCircle2 : AlertTriangle;
  const statusText = {
    balanced: dict.statusBalanced,
    tight: dict.balanceWarningTight,
    deficit: dict.balanceWarningDeficit,
  }[balanceStatus];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm tabular-nums">
          {/* "−399 is left over" would read as nonsense, so a deficit gets
              its own sentence with the shortfall as a positive amount. */}
          {format(netFixed < 0 ? dict.headlineDeficit : dict.headline, {
            income: numberFormat.format(monthlyIncome),
            costs: numberFormat.format(monthlyExpense),
            net: numberFormat.format(Math.abs(netFixed)),
          })}
        </p>
        <p className={"flex items-start gap-1.5 text-sm font-medium " + STATUS_COLOR[balanceStatus]}>
          <StatusIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {statusText}
        </p>
        {monthlySavings > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {format(dict.savingsLine, { amount: numberFormat.format(monthlySavings) })}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!hasTrendData ? (
          <p className="text-sm text-muted-foreground">{dict.noTrendData}</p>
        ) : (
          <BarChart
            caption={dict.trendTitle}
            groupHeader={dict.chartMonth}
            series={[
              { key: "income", label: dict.legendIncome },
              { key: "expense", label: dict.legendExpense },
              { key: "savings", label: dict.legendSavings },
            ]}
            groups={monthlyTotals.map((point) => ({
              key: point.month,
              label: monthFormat.format(new Date(`${point.month}-01T00:00:00`)),
              values: [point.income, point.expense, point.savings],
            }))}
            locale={locale}
            currencyCode={currencyCode}
          />
        )}
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 self-start text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            {dict.itemsToggle}
          </summary>
          <div className="grid gap-4 pt-1 sm:grid-cols-2">
            <CategoryBreakdown
              title={dict.incomeBreakdownTitle}
              items={incomeBreakdown}
              total={monthlyIncome}
              emptyMessage={dict.noIncomeItems}
              numberFormat={numberFormat}
            />
            <CategoryBreakdown
              title={dict.expenseBreakdownTitle}
              items={expenseBreakdown}
              total={monthlyExpense}
              emptyMessage={dict.noExpenseItems}
              numberFormat={numberFormat}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
