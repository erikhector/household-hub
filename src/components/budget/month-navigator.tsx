// Prev/next/"this month" month navigation for the budget pages, mirroring
// meal-planning's WeekPlanner nav strip (src/components/meal-planning/week-planner.tsx):
// plain `<Link>`s that change the `?month=` search param, so navigating is a
// full server-rendered page load driven by the URL alone — no client state.
// Shared between the household budget and personal budget, which pass their
// own `basePath` through BudgetTabs (see budget-tabs.tsx).
//
// Phone pass (Oct 2026): the conventional `‹  October 2026  ›` — arrows
// flanking a larger month name, so the month being looked at is the
// strip's headline rather than small text squeezed between two button
// groups. "This month" only appears (under the name) once you've paged
// away, since on the current month it was a button that did nothing. Every
// link carries the open tab and the category filter (`params`), so paging
// months from Transactions stays on Transactions. The arrows are real links
// styled as buttons (not a Button rendering a Link, which Base UI announces
// as a button), so they read as the navigation they are.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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
  const prevMonthKey = toMonthKey(addMonths(monthStart, -1));
  const nextMonthKey = toMonthKey(addMonths(monthStart, 1));
  const monthLabel = monthStart.toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div className="flex items-center justify-between gap-2">
      <Link
        href={budgetHref(basePath, { ...params, month: prevMonthKey })}
        aria-label={dict.previousMonth}
        className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
      >
        <ChevronLeft className="size-5" />
      </Link>
      <div className="flex min-w-0 flex-col items-center">
        <p className="truncate font-heading text-lg font-semibold">{monthLabel}</p>
        {monthKey !== currentMonthKey && (
          <Link
            href={budgetHref(basePath, params)}
            className="touch-target inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            {dict.thisMonth}
          </Link>
        )}
      </div>
      <Link
        href={budgetHref(basePath, { ...params, month: nextMonthKey })}
        aria-label={dict.nextMonth}
        className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
      >
        <ChevronRight className="size-5" />
      </Link>
    </div>
  );
}
