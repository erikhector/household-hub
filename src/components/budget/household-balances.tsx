// Pure presentational "who owes whom" view — same pattern as
// CostAnalyzer/PeriodSummary/SafeToSpend: all aggregation happens in
// src/app/dashboard/budget/page.tsx (via computeNetBalances/simplifyDebts in
// ./settle-up-calc.ts), this component just renders the result. See
// REQUIREMENTS.md's "Household expense splitting" subsection.
//
// Shows the debt-simplified settle-up list (Splitwise's pattern: net every
// pairwise balance down to the minimum number of transfers), not a raw list
// of every split — that raw list would double- (or triple-) count shared
// expenses and obscure who actually needs to pay whom. Scoped to the
// selected budget month (see page.tsx's monthTransactions), same window as
// PeriodSummary/SafeToSpend, so balances reset each month instead of
// accumulating across the household's whole history.

import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Settlement } from "@/app/dashboard/budget/settle-up-calc";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type MemberLabel = { id: string; displayName: string };

export function HouseholdBalances({
  settlements,
  members,
  dict,
  locale,
}: {
  settlements: Settlement[];
  members: MemberLabel[];
  dict: Dictionary["budget"]["balances"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? "?";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.title}</CardTitle>
        <CardDescription>{dict.subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {settlements.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {dict.allSettled}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {settlements.map((s, i) => (
              <li
                key={`${s.fromMemberId}-${s.toMemberId}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{memberName(s.fromMemberId)}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{memberName(s.toMemberId)}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-foreground">
                  {numberFormat.format(s.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
