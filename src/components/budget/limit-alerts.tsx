// UX-108: the Overview's near-or-over-limit rows. Before them, the only place
// that said a category had blown its limit was Insights' "Expenses by
// category", while the Overview's status line still said "You're in good
// shape" (DESIGN.md Hierarchy: what needs attention goes where the user
// lands). Pure presentational: the page works out the alerts with
// categoriesNearLimit (src/lib/budget-category-limit.ts) from the same rows
// Insights draws, so the two tabs never disagree.
//
// Budget redesign (Oct 2026): no longer a card of its own. The rows lead the
// Overview's single "Needs attention" card (DueRecurringWidget), above the
// bills and income that are due, so the Overview has one list of things to
// look at instead of two cards that each needed a heading.
//
// Status is never colour alone (DESIGN.md Accessibility): every row has the
// warning icon and either "N over" or "N% used" as text. The whole row is
// the link (a 44 px+ target, M3) to that category's transactions.

import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { LimitAlert } from "@/lib/budget-category-limit";

export type LimitAlertsDict = Pick<
  Dictionary["budget"]["safeToSpend"],
  "limitSpentOfLimit" | "limitOver" | "limitUsed"
>;

export type LimitAlertRow = LimitAlert & {
  /** Where the row leads (Transactions, filtered to the category), or null
   * for a row that can't be filtered to. */
  href: string | null;
};

export function LimitAlertList({
  alerts,
  numberFormat,
  dict,
}: {
  alerts: LimitAlertRow[];
  numberFormat: Intl.NumberFormat;
  dict: LimitAlertsDict;
}) {
  if (alerts.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => {
        const content = (
          <>
            <TriangleAlert
              className={"size-4 shrink-0 " + (alert.over ? "text-destructive" : "text-warning")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{alert.name}</span>
            <span className="flex shrink-0 flex-col items-end text-sm tabular-nums">
              <span className={alert.over ? "text-destructive" : "text-foreground"}>
                {format(dict.limitSpentOfLimit, {
                  spent: numberFormat.format(alert.spent),
                  limit: numberFormat.format(alert.available),
                })}
              </span>
              <span className={"text-xs " + (alert.over ? "text-destructive" : "text-muted-foreground")}>
                {alert.over
                  ? format(dict.limitOver, { amount: numberFormat.format(alert.spent - alert.available) })
                  : format(dict.limitUsed, { percent: Math.floor(alert.percent) })}
              </span>
            </span>
          </>
        );
        return (
          <li key={alert.id}>
            {alert.href ? (
              <Link
                href={alert.href}
                className="flex min-h-11 items-center gap-2 rounded-md border py-1 pr-1.5 pl-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {content}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ) : (
              <div className="flex min-h-11 items-center gap-2 rounded-md border py-1 pr-1.5 pl-3">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
