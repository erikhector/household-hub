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
// - **Screen readers** get each button's values in its name, the readout
//   as a `status` region (announced politely on a tap), and the whole
//   series as a visually hidden table (`sr-only`) — the chart drawn as
//   data, not as shapes.
// - **Colours** are chart-1 … chart-n in series order (chart-colors.ts).
// - **Phones**: twelve months don't fit 412 px, so the bars scroll sideways
//   inside the card (never the page — DESIGN.md M1) and start scrolled to
//   the latest month, the one people look for.

import { useEffect, useMemo, useRef, useState } from "react";
import { chartFill } from "@/components/charts/chart-colors";
import { barHeightPercent } from "@/lib/chart-calc";
import { createMoneyFormat } from "@/lib/currency";

export type BarSeries = { key: string; label: string };
export type BarGroup = {
  key: string;
  /** Short label under the bars ("Oct 26"). */
  label: string;
  /** One value per series, in series order. */
  values: number[];
};

export function BarChart({
  caption,
  groupHeader,
  series,
  groups,
  locale,
  currencyCode,
}: {
  /** What the chart shows — the hidden table's caption. */
  caption: string;
  /** The hidden table's first column heading ("Month"). */
  groupHeader: string;
  series: BarSeries[];
  groups: BarGroup[];
  locale: string;
  currencyCode?: string | null;
}) {
  const numberFormat = useMemo(() => createMoneyFormat(locale, currencyCode), [locale, currencyCode]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = groups.find((g) => g.key === selectedKey) ?? groups[groups.length - 1];
  const max = Math.max(0, ...groups.flatMap((g) => g.values));
  const multi = series.length > 1;

  // Start with the latest month in view (the right end on a phone).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const describe = (group: BarGroup) =>
    group.label +
    ": " +
    series.map((s, i) => (multi ? `${s.label} ` : "") + numberFormat.format(group.values[i] ?? 0)).join(", ");

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {selected && (
        <div role="status" className="flex min-h-11 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-xs font-medium text-muted-foreground">{selected.label}</span>
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5 text-sm">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${chartFill(i)}`} />
              {multi && <span className="text-muted-foreground">{s.label}</span>}
              <span className="font-semibold tabular-nums">
                {numberFormat.format(selected.values[i] ?? 0)}
              </span>
            </span>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="flex w-full min-w-0 items-end gap-2 overflow-x-auto pb-1">
        {groups.map((group) => {
          const isSelected = group.key === selected?.key;
          return (
            <button
              key={group.key}
              type="button"
              aria-pressed={isSelected}
              aria-label={describe(group)}
              onClick={() => setSelectedKey(group.key)}
              className={
                "flex min-w-11 flex-1 flex-col items-center gap-2 rounded-lg px-1 pt-2 pb-1 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted " +
                (isSelected ? "bg-muted" : "hover:bg-muted/60")
              }
            >
              <span aria-hidden className="flex h-32 w-full items-end justify-center gap-0.5">
                {series.map((s, i) => (
                  <span
                    key={s.key}
                    className={`w-full rounded-t-sm ${multi ? "max-w-3" : "max-w-8"} ${chartFill(i)}`}
                    style={{ height: `${barHeightPercent(group.values[i] ?? 0, max)}%` }}
                  />
                ))}
              </span>
              <span
                aria-hidden
                className={
                  "whitespace-nowrap text-xs " +
                  (isSelected ? "font-medium text-foreground" : "text-muted-foreground")
                }
              >
                {group.label}
              </span>
            </button>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{groupHeader}</th>
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
              {series.map((s, i) => (
                <td key={s.key}>{numberFormat.format(group.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
