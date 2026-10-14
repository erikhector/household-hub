// Shared proportional-bar breakdown list — originally PeriodSummary's own
// (transaction totals by category), now also used by FixedBudgetSummary
// (recurring template totals by item) so both "how is this split up" views
// look and behave identically.
//
// UX-39: colours come from the shared chart kit (src/components/charts/),
// chart-1 … chart-5 in row order, and a row with a `history` gets a
// spending sparkline beside its bar: the last few months of that category,
// this month last, so "is this normal for us?" is one glance away.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import { limitProgress } from "@/lib/budget-category-limit";
import { chartFill } from "@/components/charts/chart-colors";
import { Sparkline } from "@/components/charts/sparkline";

export type CategoryTotal = {
  id: string;
  name: string;
  total: number;
  /** GAP-12: the category's monthly spending cap, when it has one. A row
   * with a limit draws its bar against that limit instead of against the
   * other rows (see CategoryBreakdown). */
  limit?: number | null;
  /** GAP-21: unspent budget carried in from earlier months, present only on
   * a rollover-enabled capped row (see withCategoryRollover in
   * src/lib/budget-rollover-calc.ts). The bar is drawn against
   * limit + carried — this month's envelope, not just this month's
   * allowance. */
  carried?: number | null;
  /** UX-39: the row's total per month, oldest first and this month last
   * (withSpendHistory in src/lib/chart-calc.ts). Drawn as a sparkline when
   * the breakdown is given `history` labels. */
  history?: number[];
};

/** UX-39: what a row's sparkline needs to name its values for screen
 * readers — one short month label per history entry, and the sentence
 * they go into. */
export type CategoryHistoryLabels = {
  months: string[];
  label: string;
};

/** The two strings a capped row needs — only PeriodSummary's expense
 * breakdown passes these; FixedBudgetSummary's rows never carry a limit. */
export type CategoryLimitDict = {
  spentOfLimit: string;
  overLimitBy: string;
  carriedOver: string;
};

export function CategoryBreakdown({
  title,
  items,
  total,
  emptyMessage,
  numberFormat,
  limitDict,
  history,
}: {
  title: string;
  items: CategoryTotal[];
  total: number;
  emptyMessage: string;
  numberFormat: Intl.NumberFormat;
  limitDict?: CategoryLimitDict;
  history?: CategoryHistoryLabels;
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
              // GAP-12: a capped row's bar is "how far into its own limit",
              // not "its share of this card's total" — so a category can
              // read as nearly full even while it's a small slice of the
              // month. Purely visual: going over only turns the row red.
              //
              // GAP-21: with rollover, "its own limit" is the envelope —
              // the monthly limit plus whatever was left over from earlier
              // months — so the bar, the "spent / X" figure and the "over"
              // note all use that available amount.
              const carried = item.limit != null && item.carried ? item.carried : 0;
              const available = item.limit != null ? item.limit + carried : null;
              const progress = limitDict ? limitProgress(item.total, available) : null;
              const share = progress
                ? progress.fillPercent
                : total > 0
                  ? (item.total / total) * 100
                  : 0;
              const barColor = progress?.over
                ? "bg-destructive"
                : chartFill(index);
              const sparkline =
                history && item.history && item.history.length === history.months.length
                  ? item.history
                  : null;
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{item.name}</span>
                    {progress && limitDict && available != null ? (
                      <span
                        className={
                          "shrink-0 tabular-nums " +
                          (progress.over ? "text-destructive" : "text-muted-foreground")
                        }
                      >
                        {format(limitDict.spentOfLimit, {
                          spent: numberFormat.format(item.total),
                          limit: numberFormat.format(available),
                        })}
                        {progress.over && (
                          <>
                            {" · "}
                            {format(limitDict.overLimitBy, {
                              amount: numberFormat.format(item.total - available),
                            })}
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {numberFormat.format(item.total)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        // A capped category with nothing spent yet shows an
                        // empty track rather than the 2% sliver an uncapped
                        // row gets (that sliver only exists so a tiny share
                        // stays visible next to bigger ones).
                        style={{ width: `${progress ? share : Math.max(share, 2)}%` }}
                      />
                    </div>
                    {sparkline && history && (
                      <Sparkline
                        points={sparkline}
                        colorIndex={index}
                        className="h-5 w-14 shrink-0"
                        label={format(history.label, {
                          count: sparkline.length,
                          values: sparkline
                            .map((v, i) => `${history.months[i]} ${numberFormat.format(v)}`)
                            .join(", "),
                        })}
                      />
                    )}
                  </div>
                  {progress && limitDict && carried > 0 && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {format(limitDict.carriedOver, { amount: numberFormat.format(carried) })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
