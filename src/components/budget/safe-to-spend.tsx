// Pure presentational hero stat — same pattern as PeriodSummary/CostAnalyzer:
// all aggregation happens in the page (via computeSafeToSpend in
// src/lib/safe-to-spend-calc.ts, or src/lib/personal-budget-position.ts for
// Personal Budget and the dashboard), this component just renders the
// result. See REQUIREMENTS.md's "Safe to spend" subsection.
//
// The number is broken down line by line underneath — income (logged and
// still expected), what's been spent and saved, what's still owed from
// earlier months, what's still due — so it's never a black box: every term
// that went into it is on screen.

import Link from "next/link";
import { Banknote, PiggyBank, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type {
  ExpectedRecurringExpense,
  HouseholdDebt,
  SafeToSpendBreakdown,
  SafeToSpendStatus,
} from "@/lib/safe-to-spend-calc";
import { createMoneyFormat } from "@/lib/currency";

// Calmer three-way read on the amount (see docs/archive/JOY_GAP_BACKLOG.md item 3): a
// tight-but-not-empty balance gets its own amber tone instead of being
// lumped in with either a comfortably healthy or a truly over-budget
// number, so "$4 left" doesn't read as either as fine as "$400 left" or as
// alarming as actually being over.
const STATUS_COLOR: Record<SafeToSpendStatus, string> = {
  healthy: "text-success",
  tight: "text-warning",
  over: "text-destructive",
};

export function SafeToSpend({
  amount,
  status,
  breakdown,
  expectedRecurring,
  householdDebts = [],
  showHouseholdName = false,
  dict,
  locale,
  currencyCode,
}: {
  amount: number;
  status: SafeToSpendStatus;
  breakdown: SafeToSpendBreakdown;
  expectedRecurring: ExpectedRecurringExpense[];
  /** Personal budget only: where the user stands with each household's
   * other members. Omitted on the household budget page. */
  householdDebts?: HouseholdDebt[];
  /** Name the household on each debt line — only once the user is in more
   * than one (docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6). */
  showHouseholdName?: boolean;
  dict: Dictionary["budget"]["safeToSpend"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const summary = {
    healthy: dict.summaryHealthy,
    tight: dict.summaryTight,
    over: dict.summaryOver,
  }[status];

  // Zero lines that are always zero for most people (nothing owed from
  // earlier, nothing due) are hidden rather than shown as "–0.00"; income,
  // expenses and savings always show so the arithmetic stays readable.
  const lines: { label: string; value: number; sign: "+" | "–"; alwaysShow?: boolean }[] = [
    { label: dict.lineIncome, value: breakdown.income, sign: "+", alwaysShow: true },
    { label: dict.lineExpectedIncome, value: breakdown.dueIncome, sign: "+" },
    { label: dict.lineExpenses, value: breakdown.expense, sign: "–", alwaysShow: true },
    { label: dict.lineSavings, value: breakdown.savings, sign: "–", alwaysShow: true },
    { label: dict.lineOwedFromEarlier, value: breakdown.owedFromEarlier, sign: "–" },
    { label: dict.lineDuePayments, value: breakdown.duePayments, sign: "–" },
    { label: dict.lineDueSavings, value: breakdown.dueSavings, sign: "–" },
  ];

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
        <dl className="flex flex-col gap-1 text-sm">
          {lines
            .filter((line) => line.alwaysShow || line.value > 0.005)
            .map((line) => (
              <div key={line.label} className="flex items-center justify-between gap-2">
                <dt className="min-w-0 truncate text-muted-foreground">{line.label}</dt>
                <dd className="shrink-0 tabular-nums">
                  {line.sign}
                  {numberFormat.format(line.value)}
                </dd>
              </div>
            ))}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-1 font-medium">
            <dt className="min-w-0 truncate">{dict.lineRemaining}</dt>
            <dd className={`shrink-0 tabular-nums ${STATUS_COLOR[status]}`}>{numberFormat.format(amount)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{dict.caveat}</p>
        {expectedRecurring.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.notYetLoggedTitle}</p>
            <ul className="flex flex-col gap-1">
              {expectedRecurring.map((item) => (
                <li key={item.categoryId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate">{item.categoryName}</span>
                    {item.type === "SAVINGS" && (
                      <Badge variant="outline" className="shrink-0 gap-1 border-chart-2/30 text-chart-2">
                        <PiggyBank className="size-3" />
                        {dict.savingBadge}
                      </Badge>
                    )}
                    {item.type === "INCOME" && (
                      <Badge variant="outline" className="shrink-0 gap-1 border-success/30 text-success">
                        <Banknote className="size-3" />
                        {dict.incomeBadge}
                      </Badge>
                    )}
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
                  <span
                    className={
                      "shrink-0 tabular-nums " +
                      (item.type === "INCOME"
                        ? "text-success"
                        : item.type === "SAVINGS"
                          ? "text-chart-2"
                          : "text-destructive")
                    }
                  >
                    {item.type === "INCOME" ? "+" : "–"}
                    {numberFormat.format(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {householdDebts.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">{dict.debtsTitle}</p>
            <ul className="flex flex-col gap-1.5">
              {householdDebts.map((debt) => {
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
        )}
      </CardContent>
    </Card>
  );
}
