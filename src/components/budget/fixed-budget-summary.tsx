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

import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { BudgetBalanceStatus } from "@/lib/recurring-template-calc";
import { createMoneyFormat } from "@/lib/currency";

export type FixedMonthlyTotals = { month: string; income: number; expense: number; savings: number };

// Same calmer three-way read as SafeToSpend's STATUS_COLOR
// (src/components/budget/safe-to-spend.tsx) — a tight-but-not-negative net
// gets its own amber tone rather than being lumped in with either a
// comfortably balanced or a truly in-deficit budget.
const STATUS_COLOR: Record<BudgetBalanceStatus, string> = {
  balanced: "text-chart-5",
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
  const maxMonthlyTotal = Math.max(
    0,
    ...monthlyTotals.map((m) => Math.max(m.income, m.expense, m.savings)),
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
            <p className="text-3xl font-semibold text-chart-5">
              {numberFormat.format(monthlyIncome)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.monthlyExpenseLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-destructive">
              {numberFormat.format(monthlyExpense)}
            </p>
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
              {netFixed >= 0 ? "+" : ""}
              {numberFormat.format(netFixed)}
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
            <p className="text-3xl font-semibold text-chart-2">
              {numberFormat.format(monthlySavings)}
            </p>
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
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-chart-5" />
                  {dict.legendIncome}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-destructive" />
                  {dict.legendExpense}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-chart-2" />
                  {dict.legendSavings}
                </span>
              </div>
              <div className="flex h-52 items-end gap-3 overflow-x-auto">
                {monthlyTotals.map((point) => {
                  const label = monthFormat.format(new Date(`${point.month}-01T00:00:00`));
                  return (
                    <div
                      key={point.month}
                      className="flex min-w-16 flex-1 flex-col items-center gap-2"
                    >
                      <div className="flex h-36 w-full items-end justify-center gap-1">
                        <MonthBar
                          value={point.income}
                          max={maxMonthlyTotal}
                          className="bg-chart-5"
                          title={numberFormat.format(point.income)}
                        />
                        <MonthBar
                          value={point.expense}
                          max={maxMonthlyTotal}
                          className="bg-destructive"
                          title={numberFormat.format(point.expense)}
                        />
                        <MonthBar
                          value={point.savings}
                          max={maxMonthlyTotal}
                          className="bg-chart-2"
                          title={numberFormat.format(point.savings)}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MonthBar({
  value,
  max,
  className,
  title,
}: {
  value: number;
  max: number;
  className: string;
  title: string;
}) {
  const heightPct = value > 0 && max > 0 ? Math.max((value / max) * 100, 3) : 0;
  return (
    <div className="flex h-full w-full max-w-6 items-end">
      <div className={`w-full rounded-t-sm ${className}`} style={{ height: `${heightPct}%` }} title={title} />
    </div>
  );
}
