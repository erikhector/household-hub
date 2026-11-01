"use client";

// UX-39: the one bar chart behind every per-month chart in both budgets —
// CostAnalyzer's grocery spend (one series) and FixedBudgetSummary's
// income / costs / savings (three series side by side). It replaced two
// hand-rolled copies whose values lived in a hover-only `title`.
//
// - **Tap to read.** Each month is one button the full height of the chart
//   (≥ 44 px wide, 8 px apart: DESIGN.md M3), so a thumb can't miss it.
//   Tapping it selects that month and the readout above the bars shows
//   its values.
//   Nothing is hover-only (DESIGN.md "Context"): the latest month starts
//   selected, so the readout says something before anyone taps.
// - **Screen readers** get each button's values in its name,
//   a hidden `status` line announcing a month once it is picked (never on
//   hover: design review, Oct 2026), and the whole
//   series as a visually hidden table (`sr-only`) — the chart drawn as
//   data, not as shapes.
// - **Colours** are chart-1 … chart-n in series order (chart-colors.ts),
//   or a series' own `fill` when it is a money flow (FLOW_FILL).
// - **Phones**: twelve months don't fit 412 px, so the bars scroll sideways
//   inside the card (never the page — DESIGN.md M1) and start scrolled to
//   the latest month, the one people look for.
//
// Chart redesign (Oct 2026):
// - **A scale.** Hairlines at 0, half and a clean top (niceCeiling: 30 000,
//   not the tallest bar), labelled in compact numbers in a gutter that
//   stays put while the bars scroll, so a bar's height means an amount
//   before anything is tapped. Solid and one step off the card, never
//   dashed (dashes read as a projection).
// - **Thin marks.** Bars are at most 24 px (10 px each when grouped), 2 px
//   apart, with 4 px rounded tops and square feet on the baseline.
// - **No empty lead-in.** Months before the first one with data are left
//   out (trimLeadingEmpty), so a new budget doesn't open on a row of blanks.
// - **Hover previews.** With a mouse, pointing at a month shows its values
//   in the readout; tapping still selects (hover is never the only way).
// - **Stacked** (`stacked`): one column per month whose parts add up to a
//   whole the readout names first (`totalLabel` and each group's `total`):
//   FixedBudgetSummary's income, split into costs, savings and what's left.
//   A part at or below zero draws nothing; the readout still says its value.

import { useEffect, useMemo, useRef, useState } from "react";
import { chartFill } from "@/components/charts/chart-colors";
import { barHeightPercent, niceCeiling, trimLeadingEmpty } from "@/lib/chart-calc";
import { createMoneyFormat } from "@/lib/currency";

export type BarSeries = {
  key: string;
  label: string;
  /** A fixed fill class for this series (FLOW_FILL), when the series is a
   * money flow whose colour must match the rest of the page. Without one
   * the series takes chart-1 … chart-n by its place. */
  fill?: string;
};
export type BarGroup = {
  key: string;
  /** Short label under the bars ("Oct 26"). */
  label: string;
  /** One value per series, in series order. */
  values: number[];
  /** Stacked charts: the whole the parts add up to, named in the readout
   * before them (`totalLabel`). */
  total?: number;
};

export function BarChart({
  caption,
  groupHeader,
  series,
  groups: allGroups,
  locale,
  currencyCode,
  stacked = false,
  totalLabel,
}: {
  /** What the chart shows — the hidden table's caption. */
  caption: string;
  /** The hidden table's first column heading ("Month"). */
  groupHeader: string;
  series: BarSeries[];
  groups: BarGroup[];
  locale: string;
  currencyCode?: string | null;
  /** Draw each group's values as one stacked column, in series order from
   * the baseline up. */
  stacked?: boolean;
  /** What each group's `total` is ("Income"), shown first in the readout. */
  totalLabel?: string;
}) {
  const numberFormat = useMemo(() => createMoneyFormat(locale, currencyCode), [locale, currencyCode]);
  const tickFormat = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const groups = useMemo(() => trimLeadingEmpty(allGroups), [allGroups]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const selected = groups.find((g) => g.key === selectedKey) ?? groups[groups.length - 1];
  const shown = groups.find((g) => g.key === hoveredKey) ?? selected;
  const top = niceCeiling(
    Math.max(
      0,
      ...groups.flatMap((g) =>
        stacked ? [g.values.reduce((sum, v) => sum + Math.max(0, v), 0), g.total ?? 0] : g.values,
      ),
    ),
  );
  const multi = series.length > 1;
  const fillOf = (s: BarSeries, i: number) => s.fill ?? chartFill(i);

  // Start with the latest month in view (the right end on a phone).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const hasTotal = totalLabel != null;
  const describe = (group: BarGroup) =>
    group.label +
    ": " +
    [
      ...(hasTotal ? [`${totalLabel} ${numberFormat.format(group.total ?? 0)}`] : []),
      ...series.map((s, i) => (multi ? `${s.label} ` : "") + numberFormat.format(group.values[i] ?? 0)),
    ].join(", ");

  // The scale's three lines, top first: 100%, 50% and the baseline.
  const ticks = top > 0 ? [top, top / 2, 0] : [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {shown && (
        // The readout is also the legend: each series' swatch and name sit
        // beside its value, so colour is never the only key (≥ 2 series).
        // Not a live region: it follows the pointer and focus, and a screen
        // reader reading out every month the mouse crosses is chatter. The
        // buttons' names carry the values; the status below announces a pick.
        <div className="flex min-h-11 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-foreground">{shown.label}</span>
          {hasTotal && (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{totalLabel}</span>
              <span className="font-semibold tabular-nums">{numberFormat.format(shown.total ?? 0)}</span>
            </span>
          )}
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5 text-sm">
              <span aria-hidden className={`size-2.5 shrink-0 rounded-[3px] ${fillOf(s, i)}`} />
              {multi && <span className="text-muted-foreground">{s.label}</span>}
              <span className="font-semibold tabular-nums">
                {numberFormat.format(shown.values[i] ?? 0)}
              </span>
            </span>
          ))}
        </div>
      )}
      {/* Announced only when a month is picked (selectedKey starts null, so
          the opening month isn't read out on load). */}
      <p role="status" className="sr-only">
        {selectedKey !== null && selected ? describe(selected) : ""}
      </p>
      <div className="flex min-w-0 gap-2">
        {/* The scale's labels, outside the scrolling bars so they stay in
            view. pt-2 matches the buttons' top padding, so each label sits
            on its line. */}
        <div aria-hidden className="relative w-9 shrink-0 pt-2">
          <div className="relative h-32">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 -translate-y-1/2 text-xs leading-none text-muted-foreground tabular-nums"
                style={{ top: `${100 - (tick / top) * 100}%` }}
              >
                {tickFormat.format(tick)}
              </span>
            ))}
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-2 h-32">
            {ticks.map((tick) => (
              <span
                key={tick}
                className={"absolute inset-x-0 h-px " + (tick === 0 ? "bg-border" : "bg-border/60")}
                style={{ top: `${100 - (tick / top) * 100}%` }}
              />
            ))}
          </div>
          <div
            ref={scrollRef}
            className="relative flex w-full min-w-0 items-end gap-2 overflow-x-auto pb-1"
            onMouseLeave={() => setHoveredKey(null)}
          >
            {groups.map((group) => {
              const isSelected = group.key === selected?.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={describe(group)}
                  onClick={() => setSelectedKey(group.key)}
                  onMouseEnter={() => setHoveredKey(group.key)}
                  onFocus={() => setHoveredKey(group.key)}
                  onBlur={() => setHoveredKey(null)}
                  className={
                    "flex min-w-11 flex-1 flex-col items-center gap-2 rounded-lg px-1 pt-2 pb-1 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted " +
                    (isSelected ? "bg-muted/80" : "hover:bg-muted/50")
                  }
                >
                  {stacked ? (
                    // Parts from the baseline up, 2 px of card between them;
                    // only the topmost drawn part gets the rounded end. The
                    // gaps come out of the parts' share of the height, so a
                    // full column ends on the top line instead of 2 px per
                    // gap above it.
                    <span aria-hidden className="flex h-32 w-full flex-col-reverse items-center gap-0.5">
                      {(() => {
                        const gaps = Math.max(0, group.values.filter((v) => v > 0).length - 1);
                        return series.map((s, i) => {
                          const value = group.values[i] ?? 0;
                          if (value <= 0) return null;
                          const isTop = !group.values.slice(i + 1).some((v) => v > 0);
                          return (
                            <span
                              key={s.key}
                              className={`w-full max-w-6 shrink-0 ${isTop ? "rounded-t-[4px]" : ""} ${fillOf(s, i)}`}
                              style={{ height: `calc((100% - ${gaps * 2}px) * ${value / top})` }}
                            />
                          );
                        });
                      })()}
                    </span>
                  ) : (
                    <span aria-hidden className="flex h-32 w-full items-end justify-center gap-0.5">
                      {series.map((s, i) => (
                        <span
                          key={s.key}
                          className={`w-full rounded-t-[4px] ${multi ? "max-w-2.5" : "max-w-6"} ${fillOf(s, i)}`}
                          style={{ height: `${barHeightPercent(group.values[i] ?? 0, top)}%` }}
                        />
                      ))}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={
                      "whitespace-nowrap text-xs " +
                      (isSelected ? "font-semibold text-foreground" : "text-muted-foreground")
                    }
                  >
                    {group.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* The table sits in an sr-only div rather than being sr-only
          itself: a table never shrinks below its content, so a 1 px
          `sr-only` table still widened the page (horizontal scroll). */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{groupHeader}</th>
              {hasTotal && <th scope="col">{totalLabel}</th>}
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <th scope="row">{group.label}</th>
                {hasTotal && <td>{numberFormat.format(group.total ?? 0)}</td>}
                {series.map((s, i) => (
                  <td key={s.key}>{numberFormat.format(group.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
