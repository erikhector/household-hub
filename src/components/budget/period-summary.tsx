// Pure presentational — no client interactivity needed, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same as the dashboard overview cards.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";

export type { CategoryTotal };

export function PeriodSummary({
  income,
  expense,
  savings,
  incomeByCategory,
  expenseByCategory,
  savingsByCategory,
  dict,
  locale,
}: {
  income: number;
  expense: number;
  // Neither income nor a cost — money set aside, so it's broken out on its
  // own rather than folded into `net` below. See TransactionType's doc
  // comment in schema.prisma.
  savings: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  savingsByCategory: CategoryTotal[];
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
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {dict.savings}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-chart-2">{numberFormat.format(savings)}</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
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
        <CategoryBreakdown
          title={dict.savingsByCategory}
          items={savingsByCategory}
          total={savings}
          emptyMessage={dict.noSavings}
          numberFormat={numberFormat}
        />
      </div>
    </div>
  );
}
