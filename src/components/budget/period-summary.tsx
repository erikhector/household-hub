// Pure presentational — no client interactivity needed, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same as the dashboard overview cards.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import { createMoneyFormat } from "@/lib/currency";

export type { CategoryTotal };

export function PeriodSummary({
  income,
  expense,
  savings,
  remaining,
  incomeByCategory,
  expenseByCategory,
  savingsByCategory,
  dict,
  locale,
  currencyCode,
}: {
  income: number;
  expense: number;
  // Neither income nor a cost — money set aside, so it's broken out on its
  // own. See TransactionType's doc comment in schema.prisma.
  savings: number;
  /** "Remaining after expenses and savings" — the same number as the Safe to
   * spend card (src/lib/safe-to-spend-calc.ts), so this card and that one
   * never disagree. It replaced a plain income − expenses "Net" that
   * ignored savings and anything still due, which made the two cards show
   * different "what's left" numbers side by side. */
  remaining: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
  savingsByCategory: CategoryTotal[];
  // Narrowed to just the "summary" slice (rather than the full budget
  // dictionary) so this presentational component can be reused for the
  // personal budget too — see personal-budget/page.tsx.
  dict: Dictionary["budget"]["summary"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);

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
            <p className="text-3xl font-semibold text-success">{numberFormat.format(income)}</p>
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
              {dict.remaining}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={"text-3xl font-semibold " + (remaining >= 0 ? "text-success" : "text-destructive")}>
              {remaining >= 0 ? "+" : ""}
              {numberFormat.format(remaining)}
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
          // GAP-12: expense rows carrying a `limit` (attached by the page
          // via withCategoryLimits) draw against it. Income and savings
          // categories never have one. GAP-21: a rollover row's `carried`
          // balance is added to that limit and shown under the bar.
          limitDict={dict}
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
