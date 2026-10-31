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
import { DonutChart, type DonutNote, type DonutNoteTone, type DonutSlice } from "@/components/charts/donut-chart";
import { limitProgress } from "@/lib/budget-category-limit";
import { usualFor } from "@/lib/chart-calc";
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

  // The donut's slices: the five largest categories and the rest as
  // "Other" (six at most — see DonutChart). Each carries the notes the row
  // below would show: its limit and how it compares with usual.
  const DONUT_SLICES = 5;
  const spent = [...expenseByCategory].filter((item) => item.total > 0).sort((a, b) => b.total - a.total);
  const shown = spent.length <= DONUT_SLICES + 1 ? spent : spent.slice(0, DONUT_SLICES);
  const rest = spent.slice(shown.length);
  // Design review (Oct 2026): near or over the limit is a status, so the
  // limit note carries a tone (warning / destructive) the donut draws in
  // that colour with an icon, as the breakdown rows below do.
  const statusOf = (item: CategoryTotal): DonutNoteTone | undefined => {
    if (item.limit == null) return undefined;
    const progress = limitProgress(item.total, item.limit + (item.carried ?? 0));
    return progress?.over ? "destructive" : progress?.near ? "warning" : undefined;
  };
  const notesFor = (item: CategoryTotal): DonutNote[] => {
    const notes: DonutNote[] = [];
    if (item.limit != null) {
      const available = item.limit + (item.carried ?? 0);
      const status = statusOf(item);
      notes.push({
        text:
          format(dict.ofLimit, { limit: numberFormat.format(available) }) +
          (status === "destructive"
            ? ` · ${format(dict.overLimitBy, { amount: numberFormat.format(item.total - available) })}`
            : status === "warning"
              ? ` · ${dict.almostAtLimit}`
              : ""),
        tone: status,
      });
    }
    const usual = usualFor(item);
    if (usual) {
      notes.push({
        text: format(
          usual.direction === "more" ? dict.vsUsualMore : usual.direction === "less" ? dict.vsUsualLess : dict.vsUsualSame,
          { percent: usual.percent },
        ),
      });
    }
    return notes;
  };
  const slices: DonutSlice[] = [
    ...shown.map((item) => ({
      key: item.id,
      label: item.name,
      value: item.total,
      href: categoryHref?.(item.id) ?? null,
      notes: notesFor(item),
      status: statusOf(item),
    })),
    ...(rest.length > 0
      ? [
          {
            key: "other",
            label: dict.donutOther,
            value: rest.reduce((sum, item) => sum + item.total, 0),
            notes: [{ text: format(dict.donutOtherIncludes, { names: rest.map((item) => item.name).join(", ") }) }],
          },
        ]
      : []),
  ];

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
                // The owner's donut (Oct 2026): the overview of where the
                // money went, slices to pick; the full rows with their limit
                // meters fold away under it.
                figure={
                  <DonutChart
                    slices={slices}
                    otherKey="other"
                    totalLabel={dict.donutTotal}
                    dict={{
                      share: dict.donutShare,
                      seeTransactions: dict.donutSee,
                      hint: dict.donutHint,
                      showAll: dict.donutShowAll,
                      overLimit: dict.donutOverLimit,
                      nearLimit: dict.almostAtLimit,
                    }}
                    locale={locale}
                    currencyCode={currencyCode}
                  />
                }
                collapseLabel={dict.allCategories}
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
