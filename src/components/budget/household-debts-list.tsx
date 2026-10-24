// The "Your household balance" block: what the user owes the other members of
// each household, what they're owed, and their unpaid share of bills, with a
// Settle up link per household. Pure presentation of the loader's
// HouseholdDebt rows (src/lib/personal-budget-position.ts).
//
// Extracted from SafeToSpend (UX-112) so the same lines also show on the
// shared-costs card a member sees before they've set up any categories, where
// SafeToSpend itself isn't rendered. One component keeps both from drifting.

import Link from "next/link";
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
              <Link
                href={`/dashboard/budget?household=${debt.householdId}&tab=insights`}
                className="inline-flex items-center self-start text-xs font-medium text-primary hover:underline max-sm:min-h-11 pointer-coarse:min-h-11"
              >
                {dict.settleUpLink}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
