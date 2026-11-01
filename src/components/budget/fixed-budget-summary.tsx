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
// UX-39: the trend is the shared BarChart (src/components/charts/), stacked:
// tap a month to read its income and where it went.
//
// Budget redesign (Oct 2026): one card — a sentence with the monthly numbers
// and whether they leave room, then the trend, with the items behind it
// folded away. It used to be four stat cards, the two "recurring
// income/costs" breakdowns open and the chart, about two phone screens on its
// own. The breakdowns stay one tap away rather than going: on Personal
// Budget they're the one place the user's share of each shared household
// bill is listed (BUDGET-7).

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { BudgetBalanceStatus } from "@/lib/recurring-template-calc";
import { format } from "@/lib/i18n/format";
import { createMoneyFormat } from "@/lib/currency";
import { BarChart } from "@/components/charts/bar-chart";
import { FLOW_FILL } from "@/components/charts/chart-colors";

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
  addIncomeHref,
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
  /** UX-154: where the "nothing planned yet" state sends you to add income. */
  addIncomeHref: string;
  dict: Dictionary["budget"]["fixedSummary"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  const netFixed = monthlyIncome - monthlyExpense;
  const hasTrendData = monthlyTotals.some((m) => m.income > 0 || m.expense > 0 || m.savings > 0);
  const hasFixedSavings = monthlyTotals.some((m) => m.savings > 0);
  // UX-154: nothing planned (no income, no costs, no savings) is not a
  // balanced budget. "0.00 in, 0.00 out, 0.00 left over" with a green "room
  // in the budget" would vouch for a budget nobody has set up, so the card
  // is one neutral sentence and the way to add income.
  const unset = monthlyIncome < 0.005 && monthlyExpense < 0.005 && monthlySavings < 0.005;
  if (unset && !hasTrendData) {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
          <p className="text-sm text-muted-foreground">{dict.notSetUp}</p>
        </CardHeader>
        <CardContent>
          <Button render={<Link href={addIncomeHref} />} className="max-sm:min-h-11 pointer-coarse:min-h-11">
            {dict.addIncome}
          </Button>
        </CardContent>
      </Card>
    );
  }
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
          // Chart redesign (Oct 2026): each month's income as one column,
          // split into what went to costs, to savings and what was left, so
          // "how much did the month leave?" is the height of the top part,
          // not a sum the reader does across three side-by-side bars.
          // Design review (Oct 2026): the headline is the plan (the
          // recurring items), the chart is what was logged against them, so
          // the two can differ; the subtitle says which is which. Its parts
          // wear the money-flow colours (FLOW_FILL), so "Saved" is the same
          // colour as on Safe to spend's split bar.
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{dict.trendSubtitle}</p>
            <BarChart
              caption={dict.trendTitle}
              groupHeader={dict.chartMonth}
              stacked
              totalLabel={dict.legendIncome}
              series={[
                { key: "expense", label: dict.legendExpense, fill: FLOW_FILL.spent },
                // No savings logged against these items in any month: a
                // "Savings 0.00" key entry for a part never drawn is noise.
                ...(hasFixedSavings ? [{ key: "savings", label: dict.legendSavings, fill: FLOW_FILL.saved }] : []),
                { key: "left", label: dict.legendLeft, fill: FLOW_FILL.left },
              ]}
              groups={monthlyTotals.map((point) => ({
                key: point.month,
                label: monthFormat.format(new Date(`${point.month}-01T00:00:00`)),
                total: point.income,
                // "Not spent or saved" is negative when costs and savings ran
                // past income: the readout says so, and the column draws no
                // part for it.
                values: [
                  point.expense,
                  ...(hasFixedSavings ? [point.savings] : []),
                  point.income - point.expense - point.savings,
                ],
              }))}
              locale={locale}
              currencyCode={currencyCode}
            />
          </div>
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
