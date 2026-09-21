// Read-only "shared with your household" surface for Personal Budget — see
// PERSONAL_HOUSEHOLD_BUDGET_LINK.md. Joins two things the household budget
// already owns: a household member's own share of a posted split
// Transaction this month (TransactionSplit), and their own share of a
// household RecurringTemplate they've opted into a split for that hasn't
// been logged yet this period (RecurringTemplateSplit) — the "Rent pops up"
// case. Both are aggregated across every household the signed-in user
// belongs to, not just the "active" one (see requireHousehold's doc comment
// in src/lib/session.ts and PERSONAL_HOUSEHOLD_BUDGET_LINK.md §4).
//
// Deliberately not editable/deletable/loggable from here — the household
// budget stays the one place these get logged, edited, or acknowledged; a
// "View in {household} Budget →" link is the only control on any row, per
// PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6 ("two places to log the same bill is
// exactly the double-entry problem this design avoids"). No interactivity
// beyond that link, so this is a plain presentational component, same
// pattern as PeriodSummary/HouseholdBalances — all aggregation happens in
// src/app/dashboard/personal-budget/page.tsx.

import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type SharedPostedRow = {
  id: string;
  categoryName: string;
  /** This user's own share (TransactionSplit.amountOwed) — never the
   * transaction's full amount. */
  amount: number;
  householdName: string;
  paidByName: string | null;
};

export type SharedDueRow = {
  id: string;
  name: string;
  categoryName: string;
  /** This user's own share (RecurringTemplateSplit.amountOwed) — never the
   * template's full expected amount. */
  amount: number;
  householdName: string;
};

export function SharedWithHouseholdCard({
  postedRows,
  dueRows,
  showHouseholdName,
  monthKey,
  dict,
  locale,
}: {
  postedRows: SharedPostedRow[];
  dueRows: SharedDueRow[];
  /** Only show which household a row belongs to once the user is in more
   * than one — see PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6. */
  showHouseholdName: boolean;
  /** "YYYY-MM" — the personal budget's currently-viewed month (see
   * src/lib/budget-date-utils.ts), reused as-is for the "View in {household}
   * Budget" link's own `?month=` param since every row here (posted or due)
   * is already scoped to this same period. */
  monthKey: string;
  dict: Dictionary["personalBudget"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.shared.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{dict.shared.subtitle}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {dueRows.length === 0 && postedRows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {dict.shared.empty}
          </p>
        ) : (
          <>
            {dueRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {dict.shared.dueSectionTitle}
                </p>
                <div className="flex flex-col gap-2">
                  {dueRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            <Users className="size-3" />
                            {dict.shared.sharedBadge}
                          </Badge>
                          <span className="min-w-0 truncate font-medium" title={row.name}>
                            {row.name}
                          </span>
                          <Badge variant="outline" className="max-w-[10rem]">
                            <span className="min-w-0 truncate" title={row.categoryName}>
                              {row.categoryName}
                            </span>
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {dict.shared.yourShare}: {numberFormat.format(row.amount)}
                          {showHouseholdName ? ` · ${row.householdName}` : ""}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/budget?month=${monthKey}`}
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        {format(dict.shared.viewInHouseholdBudget, { household: row.householdName })}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {postedRows.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {dict.shared.postedSectionTitle}
                </p>
                <div className="flex flex-col gap-2">
                  {postedRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            <Users className="size-3" />
                            {dict.shared.sharedBadge}
                          </Badge>
                          <span className="min-w-0 truncate font-medium" title={row.categoryName}>
                            {row.categoryName}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {dict.shared.yourShare}: {numberFormat.format(row.amount)}
                          {showHouseholdName ? ` · ${row.householdName}` : ""}
                          {row.paidByName ? ` · ${format(dict.shared.paidBy, { name: row.paidByName })}` : ""}
                        </p>
                      </div>
                      <Link
                        href={`/dashboard/budget?month=${monthKey}`}
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        {format(dict.shared.viewInHouseholdBudget, { household: row.householdName })}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
