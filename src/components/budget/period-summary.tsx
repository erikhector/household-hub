// Pure presentational — no client interactivity needed, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same as the dashboard overview cards.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type CategoryTotal = { id: string; name: string; total: number };

const CHART_COLORS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

export function PeriodSummary({
  income,
  expense,
  incomeByCategory,
  expenseByCategory,
  dict,
  locale,
}: {
  income: number;
  expense: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  // Narrowed to just the "summary" slice (rather than the full budget
  // dictionary) so this presentational component can be reused for the
  // personal budget too — see personal-budget/page.tsx.
  dict: Dictionary["budget"]["summary"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const net = income - expense;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.income}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-chart-5">{numberFormat.format(income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.expenses}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-destructive">
              {numberFormat.format(expense)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.net}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={"text-3xl font-semibold " + (net >= 0 ? "text-chart-5" : "text-destructive")}>
              {net >= 0 ? "+" : ""}
              {numberFormat.format(net)}
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CategoryBreakdown
          title={dict.incomeByCategory}
          items={incomeByCategory}
          total={income}
          emptyMessage={dict.noIncome}
          numberFormat={numberFormat}
        />
        <CategoryBreakdown
          title={dict.expensesByCategory}
          items={expenseByCategory}
          total={expense}
          emptyMessage={dict.noExpenses}
          numberFormat={numberFormat}
        />
      </div>
    </div>
  );
}

function CategoryBreakdown({
  title,
  items,
  total,
  emptyMessage,
  numberFormat,
}: {
  title: string;
  items: CategoryTotal[];
  total: number;
  emptyMessage: string;
  numberFormat: Intl.NumberFormat;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item, index) => {
              const share = total > 0 ? (item.total / total) * 100 : 0;
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {numberFormat.format(item.total)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${CHART_COLORS[index % CHART_COLORS.length]}`}
                      style={{ width: `${Math.max(share, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
