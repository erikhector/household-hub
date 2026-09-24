// Prev/next/"this month" month navigation for the budget pages, mirroring
// meal-planning's WeekPlanner nav strip (src/components/meal-planning/week-planner.tsx):
// plain `<Link>`s that change the `?month=` search param, so navigating is a
// full server-rendered page load driven by the URL alone — no client state.
// Shared between the household budget and personal budget, which pass their
// own `basePath` through BudgetTabs (see budget-tabs.tsx).

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, parseMonthKey, toMonthKey } from "@/lib/budget-date-utils";

// Narrowed to just the three labels this needs (rather than the full budget
// dictionary) so it works for both dict.budget and dict.personalBudget, same
// trick PeriodSummary/FixedBudgetSummary use to be shared across the two.
export type MonthNavigatorDict = { previousMonth: string; nextMonth: string; thisMonth: string };

export function MonthNavigator({
  basePath,
  monthKey,
  dict,
  extraParams,
}: {
  basePath: string;
  monthKey: string;
  dict: MonthNavigatorDict;
  /** Extra query params preserved across prev/next/this-month navigation —
   * e.g. the household budget's `?household=` deep-link override (F1: a
   * link from Personal Budget into a *specific* household's budget, not
   * whichever one happens to be "active"). Omitted by any caller with
   * nothing to preserve, unaffected. */
  extraParams?: Record<string, string>;
}) {
  const monthStart = parseMonthKey(monthKey);
  const prevMonthKey = toMonthKey(addMonths(monthStart, -1));
  const nextMonthKey = toMonthKey(addMonths(monthStart, 1));
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const extraQuery = extraParams
    ? Object.entries(extraParams)
        .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
        .join("")
    : "";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={dict.previousMonth}
          render={<Link href={`${basePath}?month=${prevMonthKey}${extraQuery}`} />}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={dict.nextMonth}
          render={<Link href={`${basePath}?month=${nextMonthKey}${extraQuery}`} />}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="text-sm font-medium">{monthLabel}</p>
      <Button
        variant="outline"
        size="sm"
        render={<Link href={extraQuery ? `${basePath}?${extraQuery.slice(1)}` : basePath} />}
      >
        {dict.thisMonth}
      </Button>
    </div>
  );
}
