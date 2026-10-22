// Prev/next/"this month" month navigation for the budget pages: the shared
// PeriodSwitcher (src/components/period-switcher.tsx, also the meal
// planner's week switcher) wired to the `?month=` search param. Plain
// `<Link>`s, so navigating is a full server-rendered page load driven by the
// URL alone, with no client state. Shared between the household budget and
// personal budget, which pass their own `basePath` through BudgetTabs (see
// budget-tabs.tsx). Every link carries the open tab and the category filter
// (`params`), so paging months from Transactions stays on Transactions.

import { PeriodSwitcher } from "@/components/period-switcher";
import { addMonths, parseMonthKey, toMonthKey } from "@/lib/budget-date-utils";
import { budgetHref, type BudgetTab } from "@/lib/budget-url";
import type { Locale } from "@/lib/i18n/locales";

// Narrowed to just the three labels this needs (rather than the full budget
// dictionary) so it works for both dict.budget and dict.personalBudget, same
// trick PeriodSummary/FixedBudgetSummary use to be shared across the two.
export type MonthNavigatorDict = { previousMonth: string; nextMonth: string; thisMonth: string };

export function MonthNavigator({
  basePath,
  monthKey,
  currentMonthKey,
  locale,
  dict,
  params = {},
}: {
  basePath: string;
  monthKey: string;
  /** The server's "YYYY-MM" for today — decides whether "This month" is
   * worth showing. From the server rather than `new Date()` here, so the
   * server render and hydration can't disagree around midnight. */
  currentMonthKey: string;
  /** UX-15: the month is named in the viewer's language ("oktober 2026"),
   * not the runtime's default locale. */
  locale: Locale;
  dict: MonthNavigatorDict;
  /** Query params preserved across prev/next/this-month navigation: the
   * household budget's `?household=` deep-link override (F1: a link from
   * Personal Budget into a *specific* household's budget, not whichever one
   * happens to be "active"), the open tab and the category filter. */
  params?: { household?: string; tab?: BudgetTab; category?: string };
}) {
  const monthStart = parseMonthKey(monthKey);

  return (
    <PeriodSwitcher
      label={monthStart.toLocaleDateString(locale, { month: "long", year: "numeric" })}
      prevHref={budgetHref(basePath, { ...params, month: toMonthKey(addMonths(monthStart, -1)) })}
      nextHref={budgetHref(basePath, { ...params, month: toMonthKey(addMonths(monthStart, 1)) })}
      currentHref={budgetHref(basePath, params)}
      isCurrent={monthKey === currentMonthKey}
      dict={{ previous: dict.previousMonth, next: dict.nextMonth, current: dict.thisMonth }}
    />
  );
}
