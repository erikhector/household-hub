// The "Fixed income & costs" headline: the recurring income/costs/savings a
// household (or person) can plan for in advance, plus how the logged side of
// that has trended month to month, a breakdown of what makes up that fixed
// income/costs (same proportional-bar visualization as PeriodSummary's
// per-category breakdown), and a "is this in balance" status derived by
// computeBudgetBalanceStatus (src/lib/recurring-template-calc.ts). Pure
// presentational, fed pre-aggregated numbers from the page's Server
// Component — same convention as PeriodSummary/CostAnalyzer. Narrowed to the
// "fixedSummary" dictionary slice (rather than the full budget dictionary)
// so it can be reused for the personal budget too, same trick PeriodSummary
// already uses.
//
// UX-39: the trend is the shared BarChart (src/components/charts/): tap a
// month to read its income, costs and savings. The four totals count to
// their new value when they change (AnimatedNumber).

import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { BudgetBalanceStatus } from "@/lib/recurring-template-calc";
import { createMoneyFormat } from "@/lib/currency";
import { AnimatedNumber } from "@/components/charts/animated-number";
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
  const animated = (value: number, showPlus = false) => (
    <AnimatedNumber value={value} locale={locale} currencyCode={currencyCode} showPlus={showPlus} />
  );
  const statusLabel = {
    balanced: dict.statusBalanced,
    tight: dict.statusTight,
    deficit: dict.statusDeficit,
  }[balanceStatus];
  const warningBody = balanceStatus === "deficit" ? dict.balanceWarningDeficit : dict.balanceWarningTight;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>

      {balanceStatus !== "balanced" && (
        <div
          className={
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
            (balanceStatus === "deficit"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-warning/40 bg-warning/5 text-warning")
          }
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{warningBody}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.monthlyIncomeLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-success">{animated(monthlyIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.monthlyExpenseLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-destructive">{animated(monthlyExpense)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.netFixedLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className={"text-3xl font-semibold " + STATUS_COLOR[balanceStatus]}>
              {animated(netFixed, true)}
            </p>
            <p className={"text-xs font-medium " + STATUS_COLOR[balanceStatus]}>{statusLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.monthlySavingsLabel}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-3xl font-semibold text-chart-2">{animated(monthlySavings)}</p>
            <p className="text-xs text-muted-foreground">{dict.savingsNote}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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

      <Card>
        <CardHeader>
          <CardTitle>{dict.trendTitle}</CardTitle>
          <CardDescription>{dict.trendSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
