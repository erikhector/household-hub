// Pure presentational — no client interactivity of its own, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same as the dashboard overview cards.
// UX-39: expense rows carrying a `history` say how the month compares with
// usual ("18% more than usual").
//
// Budget redesign (Oct 2026): the four stat cards (income, expenses,
// remaining, savings) are gone — they repeated Safe to spend on the Overview
// — and the three breakdowns sit behind one switch (BreakdownSwitch), so
// "This month" is one card's worth of screen on a phone instead of seven.

import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { CategoryBreakdown, type CategoryTotal } from "@/components/budget/category-breakdown";
import { BreakdownSwitch } from "@/components/budget/breakdown-switch";
import { createMoneyFormat } from "@/lib/currency";
import { format } from "@/lib/i18n/format";

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
  currencyCode,
  categoryHref,
}: {
  income: number;
  expense: number;
  // Neither income nor a cost — money set aside, so it's broken out on its
  // own. See TransactionType's doc comment in schema.prisma.
  savings: number;
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
  /** Phone pass (Oct 2026), P3: the Transactions tab filtered to a
   * category, for that category's breakdown row; null for a row that isn't
   * one of the viewer's own categories (Personal Budget's shared rows). */
  categoryHref?: (categoryId: string) => string | null;
}) {
  const hrefFor = categoryHref ? (item: CategoryTotal) => categoryHref(item.id) : undefined;
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // The card's point in one line: what most of the money went on.
  const top = expenseByCategory.reduce<CategoryTotal | null>(
    (max, item) => (item.total > (max?.total ?? 0) ? item : max),
    null,
  );
  const topNote =
    top && expense > 0
      ? format(dict.topShare, { name: top.name, percent: Math.round((top.total / expense) * 100) })
      : undefined;

  return (
    <section aria-labelledby="period-summary-title" className="flex flex-col gap-4">
      <div>
        <h2 id="period-summary-title" className="font-heading text-base font-semibold">
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
      </div>
      <BreakdownSwitch
        panels={[
          {
            value: "expense",
            label: dict.expenses,
            content: (
              <CategoryBreakdown
                title={`${dict.expensesByCategory} · ${numberFormat.format(expense)}`}
                items={expenseByCategory}
                total={expense}
                emptyMessage={dict.noExpenses}
                numberFormat={numberFormat}
                // GAP-12: expense rows carrying a `limit` (attached by the page
                // via withCategoryLimits) draw against it. Income and savings
                // categories never have one. GAP-21: a rollover row's `carried`
                // balance is added to that limit and shown under the bar.
                limitDict={dict}
                usualDict={dict}
                note={topNote}
                hrefFor={hrefFor}
              />
            ),
          },
          {
            value: "income",
            label: dict.income,
            content: (
              <CategoryBreakdown
                title={`${dict.incomeByCategory} · ${numberFormat.format(income)}`}
                items={incomeByCategory}
                total={income}
                emptyMessage={dict.noIncome}
                numberFormat={numberFormat}
                hrefFor={hrefFor}
              />
            ),
          },
          {
            value: "savings",
            label: dict.savings,
            content: (
              <CategoryBreakdown
                title={`${dict.savingsByCategory} · ${numberFormat.format(savings)}`}
                items={savingsByCategory}
                total={savings}
                emptyMessage={dict.noSavings}
                numberFormat={numberFormat}
                hrefFor={hrefFor}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
