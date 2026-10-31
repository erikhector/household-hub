"use client";

// A donut of parts of one whole (Insights' expenses by category), where a
// slice can be picked to read it on its own. The owner asked for it (Oct
// 2026); the dataviz rules it follows:
//
// - **Six slices at most.** The page passes its largest five and folds the
//   rest into "Other" (`muted`, last): past that, slices get too thin to
//   compare or to tap.
// - **Colour follows the slice's place**, chart-1 … chart-5 from the largest,
//   with a 2-unit gap of the card between slices instead of a border.
// - **Nothing is hover- or colour-only.** Every slice also has a row in the
//   key: a real button (44 px, M3) with its swatch, name and amount, so a
//   thumb, a keyboard and a screen reader all pick from the same list. The
//   SVG is decoration on top of it (`aria-hidden`); clicking a slice there
//   does the same as its row.
// - **Selection.** With nothing picked the hole shows the total; picking a
//   slice dims the others, lifts it, and the hole shows its amount and share,
//   with its notes (limit, vs usual) and a link to its transactions under
//   the chart. Picking it again, or "Show all", goes back.

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CHART_FILL } from "@/components/charts/chart-colors";
import { createMoneyFormat } from "@/lib/currency";
import { format } from "@/lib/i18n/format";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Where "See transactions" goes; none for "Other". */
  href?: string | null;
  /** Short lines about the slice, shown when it's picked. */
  notes?: string[];
};

export type DonutDict = {
  share: string;
  seeTransactions: string;
  hint: string;
  showAll: string;
};

// The slice strokes, literal so Tailwind generates them (see chart-colors).
const STROKE = ["stroke-chart-1", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5"] as const;
const OTHER_STROKE = "stroke-muted-foreground/35";
const OTHER_FILL = "bg-muted-foreground/35";

const R = 38;
const CIRCUMFERENCE = 2 * Math.PI * R;
// The card-coloured gap between slices, in the circle's own units.
const GAP = 1.6;

export function DonutChart({
  slices,
  otherKey,
  totalLabel,
  dict,
  locale,
  currencyCode,
}: {
  /** Largest first, "Other" (if any) last. */
  slices: DonutSlice[];
  /** The key of the folded "Other" slice, drawn in the neutral colour. */
  otherKey?: string;
  /** What the hole says with nothing picked ("Spent this month"). */
  totalLabel: string;
  dict: DonutDict;
  locale: string;
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  const selected = slices.find((s) => s.key === selectedKey) ?? null;
  const toggle = (key: string) => setSelectedKey((current) => (current === key ? null : key));
  const percentOf = (value: number) => Math.round((value / total) * 100);

  const stroke = (slice: DonutSlice, i: number) => (slice.key === otherKey ? OTHER_STROKE : STROKE[i % STROKE.length]);
  const fill = (slice: DonutSlice, i: number) => (slice.key === otherKey ? OTHER_FILL : CHART_FILL[i % CHART_FILL.length]);

  // Each slice is a dashed circle: its dash is its share of the
  // circumference, offset by everything before it. Starts at 12 o'clock.
  const lengths = slices.map((slice) => (slice.value / total) * CIRCUMFERENCE);
  const arcs = slices.map((slice, i) => ({
    slice,
    i,
    dash: Math.max(0, lengths[i] - (slices.length > 1 ? GAP : 0)),
    offset: lengths.slice(0, i).reduce((sum, l) => sum + l, 0),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-square w-full max-w-60">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" className="stroke-muted" strokeWidth="14" />
          {arcs.map(({ slice, i, dash, offset }) => {
            const isSelected = slice.key === selectedKey;
            return (
              <circle
                key={slice.key}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                className={`${stroke(slice, i)} cursor-pointer transition-[opacity,stroke-width] duration-200 motion-reduce:transition-none`}
                strokeWidth={isSelected ? 18 : 14}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
                opacity={selected && !isSelected ? 0.3 : 1}
                onClick={() => toggle(slice.key)}
              />
            );
          })}
        </svg>
        {/* The hole's text, as HTML so it stays crisp and wraps. */}
        <div className="pointer-events-none absolute inset-[24%] flex flex-col items-center justify-center text-center">
          <span className="line-clamp-2 text-xs text-muted-foreground">{selected ? selected.label : totalLabel}</span>
          <span className="text-lg font-semibold tabular-nums leading-tight sm:text-xl">
            {numberFormat.format(selected ? selected.value : total)}
          </span>
          {selected && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {format(dict.share, { percent: percentOf(selected.value) })}
            </span>
          )}
        </div>
      </div>

      {/* What the picked slice says, read out when it changes. */}
      <div role="status" className="min-h-0">
        {selected ? (
          <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            {selected.notes?.map((note) => (
              <p key={note} className="text-muted-foreground">
                {note}
              </p>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {selected.href ? (
                <Link
                  href={selected.href}
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                >
                  {dict.seeTransactions}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="min-h-11 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {dict.showAll}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">{dict.hint}</p>
        )}
      </div>

      {/* The key, and the way to pick a slice without aiming at it. */}
      <ul className="flex flex-col">
        {slices.map((slice, i) => {
          const isSelected = slice.key === selectedKey;
          return (
            <li key={slice.key}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(slice.key)}
                className={
                  "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 " +
                  (isSelected ? "bg-muted" : "hover:bg-muted/60") +
                  (selected && !isSelected ? " opacity-60" : "")
                }
              >
                <span aria-hidden className={`size-3 shrink-0 rounded-[3px] ${fill(slice, i)}`} />
                <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {format(dict.share, { percent: percentOf(slice.value) })}
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {numberFormat.format(slice.value)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
