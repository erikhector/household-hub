// The "Fixed income & costs" headline: the recurring income/costs/savings a
// household (or person) can plan for in advance, plus how the logged side of
// that has trended month to month. Pure presentational, fed pre-aggregated
// numbers from the page's Server Component — same convention as
// PeriodSummary/CostAnalyzer. Narrowed to the "fixedSummary" dictionary slice
// (rather than the full budget dictionary) so it can be reused for the
// personal budget too, same trick PeriodSummary already uses.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type FixedMonthlyTotals = { month: string; income: number; expense: number; savings: number };

export function FixedBudgetSummary({
  monthlyIncome,
  monthlyExpense,
  monthlySavings,
  monthlyTotals,
  dict,
  locale,
}: {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlySavings: number;
  monthlyTotals: FixedMonthlyTotals[];
  dict: Dictionary["budget"]["fixedSummary"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  const netFixed = monthlyIncome - monthlyExpense;
  const hasTrendData = monthlyTotals.some((m) => m.income > 0 || m.expense > 0 || m.savings > 0);
  const maxMonthlyTotal = Math.max(
    0,
    ...monthlyTotals.map((m) => Math.max(m.income, m.expense, m.savings)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>

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
          <CardContent>
            <p
              className={
                "text-3xl font-semibold " + (netFixed >= 0 ? "text-chart-5" : "text-destructive")
              }
            >
              {netFixed >= 0 ? "+" : ""}
              {numberFormat.format(netFixed)}
            </p>
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
