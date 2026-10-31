// Shared proportional-bar breakdown list — originally PeriodSummary's own
// (transaction totals by category), now also used by FixedBudgetSummary
// (recurring template totals by item) so both "how is this split up" views
// look and behave identically.
//
// UX-39: a row with a `history` answers "is this normal for us?". Chart
// redesign (Oct 2026): in words ("18% more than usual", vsUsual in
// src/lib/chart-calc.ts) rather than a word-sized sparkline, which showed a
// shape but left the reader to work out what it meant.
//
// UX-115: the bars themselves carry status, not category. DESIGN.md keeps
// chart colours for marks and status for success/warning/destructive paired
// with a word, so a bar is one neutral colour, `warning` (with "Almost at
// limit") from 90% of its limit and `destructive` ("X over") past it.
// Otherwise a category at 96% could read green and one at 36% pink.

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Minus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import { limitProgress } from "@/lib/budget-category-limit";
import { usualFor } from "@/lib/chart-calc";

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
  /** The same months cut at today's day of each period, while the viewed
   * month is running; what "vs usual" compares (usualFor). */
  historySoFar?: number[];
};

/** The three ways a row's month compares with its usual (vsUsual). */
export type CategoryUsualDict = {
  vsUsualMore: string;
  vsUsualLess: string;
  vsUsualSame: string;
};

/** The two strings a capped row needs — only PeriodSummary's expense
 * breakdown passes these; FixedBudgetSummary's rows never carry a limit. */
export type CategoryLimitDict = {
  ofLimit: string;
  overLimitBy: string;
  almostAtLimit: string;
  carriedOver: string;
};

export function CategoryBreakdown({
  title,
  items,
  total,
  emptyMessage,
  numberFormat,
  limitDict,
  usualDict,
  note,
  figure,
  collapseLabel,
  hrefFor,
}: {
  title: string;
  items: CategoryTotal[];
  total: number;
  emptyMessage: string;
  numberFormat: Intl.NumberFormat;
  limitDict?: CategoryLimitDict;
  /** Rows carrying a `history` say how this month compares with usual. */
  usualDict?: CategoryUsualDict;
  /** One sentence under the title saying what the list shows ("Rent is 57%
   * of it"), so the card opens on its point rather than its parts. */
  note?: string;
  /** A chart drawn above the rows (Insights' expenses donut). */
  figure?: ReactNode;
  /** With a figure carrying the overview, the rows fold behind this
   * disclosure label rather than listing every category twice. */
  collapseLabel?: string;
  /** Phone pass (Oct 2026), P3: where a row leads — PeriodSummary sends a
   * category's row to the Transactions tab filtered to it. A row without
   * an href (or with no `hrefFor` at all, as in FixedBudgetSummary, whose
   * rows are recurring items) stays plain. */
  hrefFor?: (item: CategoryTotal) => string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length > 0 && figure}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <Rows label={collapseLabel}>
            <div className={hrefFor ? "flex flex-col gap-1" : "flex flex-col gap-3"}>
              {items.map((item) => {
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
                // Chart redesign (Oct 2026): a meter. The fill is one neutral
                // colour (UX-115) until the row means something: amber near its
                // limit, red over it, each on a track tinted from its own colour
                // so the state reads across the whole bar.
                const meter = progress?.over
                  ? { fill: "bg-destructive", track: "bg-destructive/15" }
                  : progress?.near
                    ? { fill: "bg-warning", track: "bg-warning/15" }
                    : { fill: "bg-muted-foreground/70", track: "bg-muted" };
                const statusText = progress?.over
                  ? "text-destructive"
                  : progress?.near
                    ? "text-warning"
                    : "text-muted-foreground";
                const usual = usualDict ? usualFor(item) : null;
                const usualText = usual
                  ? format(
                      usual.direction === "more"
                        ? usualDict!.vsUsualMore
                        : usual.direction === "less"
                          ? usualDict!.vsUsualLess
                          : usualDict!.vsUsualSame,
                      { percent: usual.percent },
                    )
                  : null;
                const UsualIcon = usual?.direction === "more" ? TrendingUp : usual?.direction === "less" ? TrendingDown : Minus;
                const href = hrefFor?.(item) ?? null;
                // Name and amount on one line, the meter (and the trend) under
                // them, and what the amount is measured against under that.
                // The amount is the row's number, so it's in the text colour;
                // the limit and its status are the qualifier.
                const content = (
                  <>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{numberFormat.format(item.total)}</span>
                    </div>
                    <div className={`h-2 overflow-hidden rounded-full ${meter.track}`}>
                      <div
                        className={`h-full rounded-full ${meter.fill}`}
                        // A capped category with nothing spent yet shows an
                        // empty track rather than the 2% sliver an uncapped
                        // row gets (that sliver only exists so a tiny share
                        // stays visible next to bigger ones).
                        style={{ width: `${progress ? share : Math.max(share, 2)}%` }}
                      />
                    </div>
                    {((progress && limitDict && available != null) || usualText) && (
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
                        {progress && limitDict && available != null ? (
                          <p className={`flex items-center gap-1 tabular-nums ${statusText}`}>
                            {/* DESIGN.md: status is never colour alone. */}
                            {(progress.over || progress.near) && <TriangleAlert className="size-3 shrink-0" aria-hidden />}
                            <span>
                              {format(limitDict.ofLimit, { limit: numberFormat.format(available) })}
                              {progress.over && (
                                <>
                                  {" · "}
                                  {format(limitDict.overLimitBy, {
                                    amount: numberFormat.format(item.total - available),
                                  })}
                                </>
                              )}
                              {progress.near && (
                                <>
                                  {" · "}
                                  {limitDict.almostAtLimit}
                                </>
                              )}
                              {carried > 0 && (
                                <>
                                  {" · "}
                                  {format(limitDict.carriedOver, { amount: numberFormat.format(carried) })}
                                </>
                              )}
                            </span>
                          </p>
                        ) : (
                          <span />
                        )}
                        {usualText && (
                          // Neutral, never red or green: spending more than usual
                          // isn't wrong by itself (the limit says when it is).
                          <p className="flex items-center gap-1 text-muted-foreground tabular-nums">
                            <UsualIcon className="size-3 shrink-0" aria-hidden />
                            {usualText}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                );
                // The whole row is the link (a 44 px+ target, M3), with a
                // chevron so it reads as one.
                return href ? (
                  <Link
                    key={item.id}
                    href={href}
                    className="-mx-2 flex min-h-11 items-center gap-2 rounded-md px-2 py-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">{content}</div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <div key={item.id} className="flex flex-col gap-1.5">
                    {content}
                  </div>
                );
              })}
            </div>
          </Rows>
        )}
      </CardContent>
    </Card>
  );
}

// The rows as they are, or folded behind a disclosure when a figure above
// them already gives the overview.
function Rows({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <details className="group/rows border-t border-border pt-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <ChevronDown className="size-4 transition-transform group-open/rows:rotate-180" aria-hidden />
        {label}
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}
