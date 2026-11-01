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
//
// UX-39: the headline number counts to its new value (AnimatedNumber), and
// in the current month a projected end-of-month line sits under it
// (ProjectionChart): where the number lands if this month's everyday
// spending keeps its pace. Both from the shared chart kit in
// src/components/charts/, so the household budget, Personal Budget and the
// dashboard card draw it the same way.

import Link from "next/link";
import { Banknote, ChevronDown, PiggyBank, TriangleAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import type {
  ExpectedRecurringExpense,
  HouseholdDebt,
  SafeToSpendBreakdown,
  SafeToSpendStatus,
} from "@/lib/safe-to-spend-calc";
import { incomeSplit, needsSafeToSpendSetup, type IncomeSplitPart } from "@/lib/safe-to-spend-calc";
import { createMoneyFormat } from "@/lib/currency";
import type { DailyAllowance, MonthProjection } from "@/lib/chart-calc";
import { AnimatedNumber } from "@/components/charts/animated-number";
import { ProjectionChart } from "@/components/charts/projection-chart";
import { FLOW_FILL } from "@/components/charts/chart-colors";
import { HouseholdDebtsList } from "@/components/budget/household-debts-list";

// Calmer three-way read on the amount (see docs/archive/JOY_GAP_BACKLOG.md item 3): a
// tight-but-not-empty balance gets its own amber tone instead of being
// lumped in with either a comfortably healthy or a truly over-budget
// number, so "$4 left" doesn't read as either as fine as "$400 left" or as
// alarming as actually being over.
const STATUS_COLOR: Record<SafeToSpendStatus, string> = {
  healthy: "text-success",
  tight: "text-warning",
  over: "text-destructive",
  // UX-154: no income to judge against; neutral, never the green of "healthy".
  unset: "text-muted-foreground",
};

// The split bar's parts, as marks in the money-flow colours (FLOW_FILL), so
// "Saved" is the same colour here as in the fixed income chart. "Safe to
// spend" wears the number's own status colour, so the part of the bar the
// headline is about matches the headline.
const SPLIT_FILL: Record<Exclude<IncomeSplitPart["key"], "safe">, string> = {
  spent: FLOW_FILL.spent,
  saved: FLOW_FILL.saved,
  due: FLOW_FILL.due,
  budgeted: FLOW_FILL.kept,
};
const STATUS_FILL: Record<SafeToSpendStatus, string> = {
  healthy: "bg-success",
  tight: "bg-warning",
  over: "bg-destructive",
  unset: "bg-muted-foreground",
};

export function SafeToSpend({
  amount,
  status,
  breakdown,
  expectedRecurring,
  householdDebts = [],
  showHouseholdName = false,
  projection = null,
  dailyAllowance = null,
  variant = "full",
  setupHrefs,
  limitAlertCount = 0,
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
  /** UX-39: projectMonthEnd's result for the viewed month — null (no
   * line) for any month but the current one, or before any everyday
   * spending. */
  projection?: MonthProjection | null;
  /** UX-117: the headline spread over the days left this month — null
   * for any month but the current one, or with nothing left to spend. */
  dailyAllowance?: DailyAllowance | null;
  /** Phone pass (Oct 2026), P4. "full" (the dashboard card) shows every
   * line of the arithmetic and what's still due. "compact" (the budget
   * pages' Overview, where Needs attention right below already lists what's
   * due, with buttons) keeps the number, its summary and the daily
   * allowance, and folds the projection, the arithmetic and caveat into a
   * "How we got this number" disclosure (DESIGN.md M6), so Overview stops
   * repeating itself. */
  variant?: "full" | "compact";
  /** UX-116: where the setup state's two actions go (add income, add
   * regular bills). */
  setupHrefs: { income: string; bills: string };
  /** UX-108: how many categories are at 90% or more of their limit (the
   * Overview lists them under this card). Only changes the "healthy" line. */
  limitAlertCount?: number;
  dict: Dictionary["budget"]["safeToSpend"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const setup = needsSafeToSpendSetup(breakdown, expectedRecurring);
  const split = incomeSplit(breakdown, amount);
  const splitLabel: Record<IncomeSplitPart["key"], string> = {
    spent: dict.splitSpent,
    saved: dict.splitSaved,
    due: dict.splitDue,
    budgeted: dict.splitBudgeted,
    safe: dict.splitSafe,
  };
  // UX-108: "good shape" would contradict a category already at or over its
  // limit, so a healthy number with such categories points at them instead.
  // A tight or over status keeps its own, stronger line.
  const summary = {
    healthy:
      limitAlertCount > 0
        ? format(plural(limitAlertCount, dict.summaryLimits), { count: limitAlertCount })
        : dict.summaryHealthy,
    tight: dict.summaryTight,
    over: dict.summaryOver,
    unset: dict.setupSummary,
  }[status];

  // Zero lines that are always zero for most people (nothing owed from
  // earlier, nothing due) are hidden rather than shown as "–0.00"; income,
  // expenses and savings always show so the arithmetic stays readable.
  // Savings carry "→", the same sign as on the transaction rows: money set
  // aside still comes off what's safe to spend, but it isn't spent.
  const lines: { label: string; value: number; sign: "+" | "–" | "→"; alwaysShow?: boolean }[] = [
    { label: dict.lineIncome, value: breakdown.income, sign: "+", alwaysShow: true },
    { label: dict.lineExpectedIncome, value: breakdown.dueIncome, sign: "+" },
    { label: dict.lineExpenses, value: breakdown.expense, sign: "–", alwaysShow: true },
    { label: dict.lineSavings, value: breakdown.savings, sign: "→", alwaysShow: true },
    { label: dict.lineOwedFromEarlier, value: breakdown.owedFromEarlier, sign: "–" },
    { label: dict.lineDuePayments, value: breakdown.duePayments, sign: "–" },
    { label: dict.lineDueSavings, value: breakdown.dueSavings, sign: "→" },
    // UX-138: what is left of the monthly limits. Earmarked, so it comes off
    // the number even though it isn't spent yet.
    { label: dict.lineStillBudgeted, value: breakdown.stillBudgeted, sign: "–" },
  ];

  const arithmetic = (
    <>
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
      <p className="text-xs text-muted-foreground">{dict.signLegend}</p>
      <p className="text-xs text-muted-foreground">{dict.caveat}</p>
    </>
  );
  const expectedList = (
    <>
      {expectedRecurring.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">{dict.notYetLoggedTitle}</p>
          <ul className="flex flex-col gap-1">
            {expectedRecurring.map((item) => (
              <li key={item.categoryId} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{item.categoryName}</span>
                  {item.type === "SAVINGS" && (
                    <Badge variant="outline" className="shrink-0 gap-1">
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
                  // Money in is `success`; a due bill or saving is plain
                  // text (red is for over budget, chart colours for marks).
                  className={"shrink-0 tabular-nums " + (item.type === "INCOME" ? "text-success" : "")}
                >
                  {item.type === "INCOME" ? "+" : item.type === "SAVINGS" ? "→" : "–"}
                  {numberFormat.format(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // UX-116: no income and nothing recurring yet, so there's no number to
  // stand behind. Say what's missing and offer the two ways to supply it,
  // instead of a green "+0.00" and "good shape".
  const setupContent = (
    <>
      <p className="text-sm text-foreground">{dict.setupSummary}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" render={<Link href={setupHrefs.income} />} className="max-sm:min-h-11 pointer-coarse:min-h-11">
          {dict.setupIncome}
        </Button>
        <Button
          variant="outline"
          render={<Link href={setupHrefs.bills} />}
          className="max-sm:min-h-11 pointer-coarse:min-h-11"
        >
          {dict.setupBills}
        </Button>
      </div>
    </>
  );
  const numberContent = (
    <>
      <p className="text-sm text-foreground">{summary}</p>
      <p className={`font-display text-4xl font-bold ${STATUS_COLOR[status]}`}>
        <AnimatedNumber value={amount} locale={locale} currencyCode={currencyCode} showPlus />
      </p>
      {dailyAllowance && (
        <p className="text-sm text-foreground">
          {format(plural(dailyAllowance.daysLeft, dict.dailyAllowance), {
            amount: numberFormat.format(dailyAllowance.perDay),
            count: dailyAllowance.daysLeft,
          })}
        </p>
      )}
      {/* Chart redesign (Oct 2026): where the month's income goes, as one
          bar with a labelled key. It answers "why is the number this?"
          without opening the arithmetic, in the arithmetic's own terms. */}
      {variant === "compact" && split && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {format(dict.splitTitle, { amount: numberFormat.format(split.income) })}
          </p>
          <div aria-hidden className="flex h-3 gap-0.5 overflow-hidden rounded-full">
            {split.parts.map((part) => (
              <span
                key={part.key}
                className={part.key === "safe" ? STATUS_FILL[status] : SPLIT_FILL[part.key]}
                style={{ width: `${(part.value / split.scale) * 100}%` }}
              />
            ))}
          </div>
          {/* Capped so on a wide card an amount stays near its name. */}
          <ul className="grid max-w-90 grid-cols-1 gap-x-4 gap-y-1 text-xs min-[360px]:grid-cols-2">
            {split.parts.map((part) => (
              <li key={part.key} className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 rounded-[3px] ${part.key === "safe" ? STATUS_FILL[status] : SPLIT_FILL[part.key]}`}
                />
                <span className="min-w-0 truncate text-muted-foreground">{splitLabel[part.key]}</span>
                <span className="ml-auto shrink-0 font-medium tabular-nums">{numberFormat.format(part.value)}</span>
              </li>
            ))}
          </ul>
          {split.over > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {format(dict.splitOver, { amount: numberFormat.format(split.over) })}
            </p>
          )}
        </div>
      )}
      {variant === "full" ? (
        <>
          {projection && <ProjectionChart projection={projection} numberFormat={numberFormat} dict={dict} />}
          {arithmetic}
          {expectedList}
        </>
      ) : (
        // Budget redesign (Oct 2026): the compact card is the number, what
        // it means and what it buys per day, and nothing else. The month-end
        // projection, the income/expenses/savings totals line and the sign
        // legend all sat between the number and the next thing to do, so
        // they now live with the arithmetic behind one tap (DESIGN.md M6).
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 self-start text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            {dict.breakdownToggle}
          </summary>
          <div className="flex flex-col gap-3 pt-1">
            {projection && <ProjectionChart projection={projection} numberFormat={numberFormat} dict={dict} />}
            {arithmetic}
            {/* UX-118: the still-due list is the Needs attention card's
                job right below; repeating it here listed every item twice. */}
          </div>
        </details>
      )}
    </>
  );

  return (
    <Card className="border-2 border-primary/40 bg-primary/5">
      <CardHeader>
        <CardTitle className="font-heading text-base font-semibold text-foreground">
          {dict.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {setup ? setupContent : numberContent}
        {/* The budget pages show debts in their own Settle up card under
            Needs attention (budget-tabs.tsx); only the dashboard's full card
            still carries them. */}
        {variant === "full" && (
          <HouseholdDebtsList
            debts={householdDebts}
            showHouseholdName={showHouseholdName}
            numberFormat={numberFormat}
            dict={dict}
          />
        )}
      </CardContent>
    </Card>
  );
}
