// The "Your household balance" block: what the user owes the other members of
// each household, what they're owed, and their unpaid share of bills, with a
// Settle up link per household. Pure presentation of the loader's
// HouseholdDebt rows (src/lib/personal-budget-position.ts).
//
// Extracted from SafeToSpend (UX-112) so the same lines also show on the
// shared-costs card a member sees before they've set up any categories, where
// SafeToSpend itself isn't rendered. One component keeps both from drifting.
//
// Budget redesign (Oct 2026): on the Personal Budget's Overview the lines
// left the Safe to spend card for a Settle up card of their own
// (HouseholdDebtsCard below), in the slot where the household budget shows
// who owes whom, so both budgets put settling up in the same place.

import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { HouseholdDebt } from "@/lib/safe-to-spend-calc";

export type HouseholdDebtsDict = Pick<
  Dictionary["budget"]["safeToSpend"],
  "debtsTitle" | "youOwe" | "youOweIn" | "owedToYou" | "owedToYouIn" | "unpaidBills" | "unpaidBillsIn" | "settleUpLink"
>;

export function HouseholdDebtsList({
  debts,
  showHouseholdName,
  numberFormat,
  dict,
}: {
  debts: HouseholdDebt[];
  /** Name the household on each line — only once the user is in more than one. */
  showHouseholdName: boolean;
  numberFormat: Intl.NumberFormat;
  dict: HouseholdDebtsDict;
}) {
  if (debts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">{dict.debtsTitle}</p>
      <DebtLines debts={debts} showHouseholdName={showHouseholdName} numberFormat={numberFormat} dict={dict} />
    </div>
  );
}

/** The same lines as their own card, titled — the budget Overview's Settle
 * up slot. Renders nothing with no debt, so the card only shows when there
 * is something to settle. */
export function HouseholdDebtsCard({
  debts,
  showHouseholdName,
  numberFormat,
  dict,
}: {
  debts: HouseholdDebt[];
  showHouseholdName: boolean;
  numberFormat: Intl.NumberFormat;
  dict: HouseholdDebtsDict;
}) {
  if (debts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base font-semibold">{dict.debtsTitle}</h2>
      </CardHeader>
      <CardContent>
        <DebtLines debts={debts} showHouseholdName={showHouseholdName} numberFormat={numberFormat} dict={dict} />
      </CardContent>
    </Card>
  );
}

function DebtLines({
  debts,
  showHouseholdName,
  numberFormat,
  dict,
}: {
  debts: HouseholdDebt[];
  showHouseholdName: boolean;
  numberFormat: Intl.NumberFormat;
  dict: HouseholdDebtsDict;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {debts.map((debt) => {
        const household = showHouseholdName ? debt.householdName : "";
        return (
          <li key={debt.householdId} className="flex flex-col gap-0.5 text-sm">
            {debt.owedToMembers > 0.005 && (
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {household ? format(dict.youOweIn, { household }) : dict.youOwe}
                </span>
                <span className="shrink-0 tabular-nums text-destructive">
                  {numberFormat.format(debt.owedToMembers)}
                </span>
              </span>
            )}
            {debt.owedToMembers < -0.005 && (
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {household ? format(dict.owedToYouIn, { household }) : dict.owedToYou}
                </span>
                <span className="shrink-0 tabular-nums text-success">
                  {numberFormat.format(-debt.owedToMembers)}
                </span>
              </span>
            )}
            {debt.owedToBills > 0.005 && (
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {household ? format(dict.unpaidBillsIn, { household }) : dict.unpaidBills}
                </span>
                <span className="shrink-0 tabular-nums text-warning">
                  {numberFormat.format(debt.owedToBills)}
                </span>
              </span>
            )}
            {/* Who owes whom (with Clear debt) sits on the household
                budget's Overview whenever there is a debt. */}
            <Link
              href={`/dashboard/budget?household=${debt.householdId}`}
              className="inline-flex items-center self-start text-xs font-medium text-primary hover:underline max-sm:min-h-11 pointer-coarse:min-h-11"
            >
              {dict.settleUpLink}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
