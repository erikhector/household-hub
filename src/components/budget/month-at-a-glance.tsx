// "{Month} at a glance" (budget redesign, Oct 2026): the budget Overview's
// quick comparison of where the month stands against the one before. Four
// rows — income, spent, saved, left over — each with this month's amount,
// the change in words ("8% less") and a pair of bars, this month over last,
// on the same scale, so the difference is seen before it's read. Then "What
// stands out": the categories furthest from their usual (standOuts).
//
// Pure presentational, fed by the page (src/lib/month-comparison.ts does the
// arithmetic). The change is in neutral text with an arrow: spending more,
// or earning less, isn't a fault by itself, and the status colours stay for
// things that are (DESIGN.md, Colour). The bars carry no meaning the text
// doesn't, so they're hidden from screen readers.

import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { changeOf, type MonthTotals, type StandOut } from "@/lib/month-comparison";

type GlanceDict = Dictionary["budget"]["glance"];

const ROWS = [
  { key: "income", label: "income" },
  { key: "expense", label: "spent" },
  { key: "savings", label: "saved" },
  { key: "left", label: "left" },
] as const satisfies readonly { key: keyof MonthTotals; label: keyof GlanceDict }[];

export function MonthAtAGlance({
  current,
  previous,
  partial,
  monthName,
  previousMonthName,
  standOuts,
  dict,
  locale,
  currencyCode,
}: {
  current: MonthTotals;
  previous: MonthTotals;
  /** True while the month is running: `previous` is cut at the same day. */
  partial: boolean;
  /** "October", "September" — the viewed month and the one before. */
  monthName: string;
  previousMonthName: string;
  standOuts: StandOut[];
  dict: GlanceDict;
  locale: Locale;
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // Nothing logged in either month: nothing to compare.
  if (ROWS.every(({ key }) => current[key] === 0 && previous[key] === 0)) return null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold">{format(dict.title, { month: monthName })}</h2>
        {/* The key for the paired bars, in the sentence that says what
            they compare. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{format(partial ? dict.vsSameDay : dict.vsWhole, { month: previousMonthName })}</span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-primary" />
            {monthName}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-muted-foreground/35" />
            {previousMonthName}
          </span>
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          {ROWS.map(({ key, label }) => {
            const now = current[key];
            const before = previous[key];
            const change = changeOf(now, before);
            const scale = Math.max(Math.abs(now), Math.abs(before)) || 1;
            const Arrow = change.direction === "more" ? ArrowUpRight : change.direction === "less" ? ArrowDownRight : Minus;
            const changeText =
              change.direction === "more"
                ? format(dict.more, { percent: change.percent })
                : change.direction === "less"
                  ? format(dict.less, { percent: change.percent })
                  : change.direction === "new"
                    ? dict.new
                    : dict.same;
            return (
              <li key={key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{dict[label]}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{numberFormat.format(now)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div aria-hidden className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* A negative "left over" has no bar: the amount says it. */}
                    <span className="h-2 rounded-full bg-primary" style={{ width: `${(Math.max(0, now) / scale) * 100}%` }} />
                    <span
                      className="h-2 rounded-full bg-muted-foreground/35"
                      style={{ width: `${(Math.max(0, before) / scale) * 100}%` }}
                    />
                  </div>
                  <span className="flex w-32 shrink-0 items-center justify-end gap-1 text-xs text-muted-foreground tabular-nums">
                    <Arrow className="size-3.5 shrink-0" aria-hidden />
                    {changeText}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {standOuts.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">{dict.standOutTitle}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {standOuts.map((s) => {
                const Icon = s.direction === "more" ? TrendingUp : TrendingDown;
                return (
                  <li key={s.name} className="flex items-center gap-2">
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      {format(s.direction === "more" ? dict.standOutMore : dict.standOutLess, {
                        name: s.name,
                        percent: s.percent,
                      })}
                    </span>
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
