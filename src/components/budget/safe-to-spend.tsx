// Pure presentational hero stat — same pattern as PeriodSummary/CostAnalyzer:
// all aggregation happens in src/app/dashboard/budget/page.tsx (via
// computeSafeToSpend in src/lib/safe-to-spend-calc.ts), this component just renders
// the result. See REQUIREMENTS.md's "Safe to spend" subsection.

import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { ExpectedRecurringExpense, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";

// Calmer three-way read on the amount (see docs/archive/JOY_GAP_BACKLOG.md item 3): a
// tight-but-not-empty balance gets its own amber tone instead of being
// lumped in with either a comfortably healthy or a truly over-budget
// number, so "$4 left" doesn't read as either as fine as "$400 left" or as
// alarming as actually being over.
const STATUS_COLOR: Record<SafeToSpendStatus, string> = {
  healthy: "text-chart-5",
  tight: "text-warning",
  over: "text-destructive",
};

export function SafeToSpend({
  amount,
  status,
  expectedRecurring,
  dict,
  locale,
}: {
  amount: number;
  status: SafeToSpendStatus;
  expectedRecurring: ExpectedRecurringExpense[];
  dict: Dictionary["budget"]["safeToSpend"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const summary = {
    healthy: dict.summaryHealthy,
    tight: dict.summaryTight,
    over: dict.summaryOver,
  }[status];

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-foreground">{summary}</p>
        <p className={`font-display text-4xl font-bold ${STATUS_COLOR[status]}`}>
          {amount >= 0 ? "+" : ""}
          {numberFormat.format(amount)}
        </p>
        <p className="text-xs text-muted-foreground">{dict.caveat}</p>
        {expectedRecurring.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.notYetLoggedTitle}</p>
            <ul className="flex flex-col gap-1">
              {expectedRecurring.map((item) => (
                <li key={item.categoryId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{item.categoryName}</span>
                    {item.source === "shared" && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1"
                        title={item.householdName ? format(dict.sharedBadgeTitle, { household: item.householdName }) : undefined}
                      >
                        <Users className="size-3" />
                        {dict.sharedBadge}
                      </Badge>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-destructive">
                    –{numberFormat.format(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
