// UX-112: shown on the personal Overview and the home page while the member
// has no personal categories yet. Without it, a partner splitting a dinner
// left the new member with only "Let's set up your budget": the 470 they owe
// sat on the Transactions and Insights tabs, which nothing pointed them to.
// Once they have categories, SafeToSpend carries the same balance and this
// card is no longer rendered.
//
// Presentational: the page computes the summary (src/lib/shared-costs-summary.ts)
// and the debts (src/lib/personal-budget-position.ts).

import Link from "next/link";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HouseholdDebtsList } from "@/components/budget/household-debts-list";
import { createMoneyFormat } from "@/lib/currency";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { HouseholdDebt } from "@/lib/safe-to-spend-calc";
import type { SharedCostsSummary } from "@/lib/shared-costs-summary";

export function SharedCostsCard({
  summary,
  debts,
  showHouseholdName,
  transactionsHref,
  dict,
  locale,
}: {
  summary: SharedCostsSummary;
  debts: HouseholdDebt[];
  showHouseholdName: boolean;
  /** The personal budget's Transactions tab, where the shared rows are listed. */
  transactionsHref: string;
  dict: Dictionary["personalBudget"];
  locale: Locale;
}) {
  const numberFormat = createMoneyFormat(locale, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-chart-2/15 text-chart-2">
            <Users className="size-4 shrink-0" />
          </span>
          {dict.shared.costsTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{dict.shared.costsBody}</p>
        {summary.monthShare > 0 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0">{dict.shared.monthShare}</span>
            <span className="shrink-0 font-medium tabular-nums">{numberFormat.format(summary.monthShare)}</span>
          </div>
        )}
        <HouseholdDebtsList
          debts={debts}
          showHouseholdName={showHouseholdName}
          numberFormat={numberFormat}
          dict={dict.safeToSpend}
        />
        <Link
          href={transactionsHref}
          className="inline-flex items-center self-start text-sm font-medium text-primary hover:underline max-sm:min-h-11 pointer-coarse:min-h-11"
        >
          {dict.shared.viewShared}
        </Link>
      </CardContent>
    </Card>
  );
}
