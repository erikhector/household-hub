// Pure presentational hero stat — same pattern as PeriodSummary/CostAnalyzer:
// all aggregation happens in src/app/dashboard/budget/page.tsx (via
// computeSafeToSpend in src/lib/safe-to-spend-calc.ts), this component just renders
// the result. See REQUIREMENTS.md's "Safe to spend" subsection.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type { ExpectedRecurringExpense } from "@/lib/safe-to-spend-calc";

export function SafeToSpend({
  amount,
  expectedRecurring,
  dict,
  locale,
}: {
  amount: number;
  expectedRecurring: ExpectedRecurringExpense[];
  dict: Dictionary["budget"]["safeToSpend"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const amountColor = amount >= 0 ? "text-chart-5" : "text-destructive";

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className={`font-display text-4xl font-bold ${amountColor}`}>
          {amount >= 0 ? "+" : ""}
          {numberFormat.format(amount)}
        </p>
        <p className="text-xs text-muted-foreground">{dict.caveat}</p>
        {expectedRecurring.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.notYetLoggedTitle}</p>
            <ul className="flex flex-col gap-1">
              {expectedRecurring.map((item) => (
                <li key={item.categoryId} className="flex items-center justify-between text-sm">
                  <span>{item.categoryName}</span>
                  <span className="tabular-nums text-destructive">
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
