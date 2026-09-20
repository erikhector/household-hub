// Prev/next/"this month" month navigation for the budget pages, mirroring
// meal-planning's WeekPlanner nav strip (src/components/meal-planning/week-planner.tsx):
// plain `<Link>`s that change the `?month=` search param, so navigating is a
// full server-rendered page load driven by the URL alone — no client state.
// Shared between the household budget and personal budget, which pass their
// own `basePath` (see budget-tabs.tsx / personal-budget-tabs.tsx).

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
}: {
  basePath: string;
  monthKey: string;
  dict: MonthNavigatorDict;
}) {
  const monthStart = parseMonthKey(monthKey);
  const prevMonthKey = toMonthKey(addMonths(monthStart, -1));
  const nextMonthKey = toMonthKey(addMonths(monthStart, 1));
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={dict.previousMonth}
          render={<Link href={`${basePath}?month=${prevMonthKey}`} />}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={dict.nextMonth}
          render={<Link href={`${basePath}?month=${nextMonthKey}`} />}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="text-sm font-medium">{monthLabel}</p>
      <Button variant="outline" size="sm" render={<Link href={basePath} />}>
        {dict.thisMonth}
      </Button>
    </div>
  );
}
