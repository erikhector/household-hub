// GAP-22: progress towards each SAVINGS category's goal, on the Overview tab
// under Safe to spend. Pure presentational, same pattern as SafeToSpend and
// PeriodSummary: the page works out each category's all-time savings and
// runs them through savingsGoalRows (src/lib/savings-goal-calc.ts); this
// just draws the result. Shared by the household and personal budget pages.
//
// Informational only (BACKLOG.md's Guardrails: no streaks or loss-aversion
// on money): the bar is always the calm savings colour, a passed date is
// stated plainly rather than flagged in red, and nothing here notifies or
// gates a transaction. Unlike the rest of Overview it doesn't follow the
// month navigator: a goal is a running total towards a destination, so it
// always shows where things stand today.

import { PiggyBank } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { SavingsGoalProgress } from "@/lib/savings-goal-calc";
import { createMoneyFormat } from "@/lib/currency";

export type SavingsGoalRow = {
  id: string;
  name: string;
  goalDate: Date | null;
  progress: SavingsGoalProgress;
};

export function SavingsGoals({
  goals,
  dict,
  locale,
  currencyCode,
}: {
  goals: SavingsGoalRow[];
  dict: Dictionary["budget"]["savingsGoals"];
  locale: Locale;
  /** GAP-13: the viewed household's display currency. Left unset by the
   * personal budget page (no single household currency), so its amounts
   * stay symbol-free like the rest of that page. */
  currencyCode?: string | null;
}) {
  if (goals.length === 0) return null;

  const numberFormat = createMoneyFormat(locale, currencyCode);
  // goalDate is UTC midnight of the picked day (goalDateField), so it's
  // formatted in UTC to show that same day in every time zone.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  function paceLine({ progress, goalDate }: SavingsGoalRow): string {
    const date = goalDate ? dateFormat.format(goalDate) : "";
    const remaining = numberFormat.format(progress.remaining);
    switch (progress.status) {
      case "reached":
        return dict.reached;
      case "noDate":
        return format(dict.toGo, { amount: remaining });
      case "datePassed":
        return format(dict.datePassed, { amount: remaining, date });
      case "inProgress":
        // One month left (the goal falls later this month): "this month"
        // reads better than "~X/month" for a single deposit.
        return format(progress.monthsLeft === 1 ? dict.saveThisMonth : dict.savePerMonth, {
          amount: numberFormat.format(progress.perMonth ?? progress.remaining),
          date,
        });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <PiggyBank className="size-4 text-chart-3" />
          {dict.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {goals.map((goal) => (
          <div key={goal.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{goal.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {format(dict.savedOfGoal, {
                  saved: numberFormat.format(goal.progress.saved),
                  goal: numberFormat.format(goal.progress.goal),
                })}
              </span>
            </div>
            <div
              // Chart redesign (Oct 2026): a meter whose track is a light
              // step of its own fill, so the whole bar reads as the goal.
              // Design review: in the "saved" flow colour (FLOW_FILL).
              className="h-2 w-full overflow-hidden rounded-full bg-chart-3/15"
              role="progressbar"
              aria-label={goal.name}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(goal.progress.fillPercent)}
            >
              <div
                className="h-full rounded-full bg-chart-3"
                style={{ width: `${goal.progress.fillPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{paceLine(goal)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
