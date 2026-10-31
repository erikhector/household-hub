"use client";

// A donut of parts of one whole (Insights' expenses by category), where a
// slice can be picked to read it on its own. The owner asked for it (Oct
// 2026); the dataviz rules it follows:
//
// - **Six slices at most.** The page passes its largest five and folds the
//   rest into "Other" (last): past that, slices get too thin to compare or
//   to tap.
// - **Emphasis, not a colour per category** (design review, Oct 2026). The
//   slices used to take chart-1 … chart-5 by rank, so a category changed
//   colour whenever another overtook it, and the same teal meant Transport
//   here and Saved on Safe to spend. Now every slice is one context grey
//   (lighter still for "Other"), with a 2-unit gap of the card between
//   slices instead of a border, and only the slice the story is about wears
//   the accent (EMPHASIS_*, chart-colors.ts): the picked one, or with
//   nothing picked the largest, which the card's line ("Groceries is 40% of
//   what went out") is already about. The accent is no money-flow colour, so
//   nothing here can be mistaken for spent, saved or due.
// - **Nothing is hover- or colour-only.** Every slice also has a row in the
//   key: a real button (44 px, M3) with its swatch, name and amount, so a
//   thumb, a keyboard and a screen reader all pick from the same list. The
//   SVG is decoration on top of it (`aria-hidden`); clicking a slice there
//   does the same as its row. A category near or over its limit has a
//   warning marker on its key row, and its note says so in the status
//   colour with an icon (never colour alone).
// - **Selection.** With nothing picked the hole shows the total; picking a
//   slice lifts it into the accent and the hole shows its amount and share,
//   with its notes (limit, vs usual) and a link to its transactions under
//   the chart. Picking it again, or "Show all", goes back. Only the notes
//   are a live region: the link and button around them aren't read out on
//   every pick.

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { CONTEXT_FILL, CONTEXT_STROKE, EMPHASIS_FILL, EMPHASIS_STROKE } from "@/components/charts/chart-colors";
import { createMoneyFormat } from "@/lib/currency";
import { format } from "@/lib/i18n/format";

export type DonutNoteTone = "warning" | "destructive";

/** A short line about a slice, shown when it's picked. A `tone` marks a
 * status (near or over a limit), drawn in that colour with an icon. */
export type DonutNote = { text: string; tone?: DonutNoteTone };

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Where "See transactions" goes; none for "Other". */
  href?: string | null;
  notes?: DonutNote[];
  /** Near ("warning") or over ("destructive") its limit: a marker on the
   * key row, so it shows before anything is picked. */
  status?: DonutNoteTone;
};

export type DonutDict = {
  share: string;
  seeTransactions: string;
  hint: string;
  showAll: string;
  /** The key row marker's words, for screen readers. */
  overLimit: string;
  nearLimit: string;
};

// "Other" is lighter than the named slices: it's the rest, not a category.
const OTHER_STROKE = "stroke-muted-foreground/20";
const OTHER_FILL = "bg-muted-foreground/20";
const TONE_TEXT: Record<DonutNoteTone, string> = { warning: "text-warning", destructive: "text-destructive" };

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
  /** The key of the folded "Other" slice, drawn in the lightest grey. */
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

  // The slice in the accent: the picked one, else the largest named one.
  const emphasisedKey = selected?.key ?? slices.find((s) => s.key !== otherKey)?.key ?? null;
  const stroke = (slice: DonutSlice) =>
    slice.key === emphasisedKey ? EMPHASIS_STROKE : slice.key === otherKey ? OTHER_STROKE : CONTEXT_STROKE;
  const fill = (slice: DonutSlice) =>
    slice.key === emphasisedKey ? EMPHASIS_FILL : slice.key === otherKey ? OTHER_FILL : CONTEXT_FILL;

  // Each slice is a dashed circle: its dash is its share of the
  // circumference, offset by everything before it. Starts at 12 o'clock.
  const lengths = slices.map((slice) => (slice.value / total) * CIRCUMFERENCE);
  const arcs = slices.map((slice, i) => ({
    slice,
    dash: Math.max(0, lengths[i] - (slices.length > 1 ? GAP : 0)),
    offset: lengths.slice(0, i).reduce((sum, l) => sum + l, 0),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto aspect-square w-full max-w-60">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={R} fill="none" className="stroke-muted" strokeWidth="14" />
          {arcs.map(({ slice, dash, offset }) => (
            <circle
              key={slice.key}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              className={`${stroke(slice)} cursor-pointer transition-[stroke,stroke-width] duration-200 motion-reduce:transition-none`}
              strokeWidth={slice.key === selectedKey ? 18 : 14}
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              strokeDashoffset={-offset}
              onClick={() => toggle(slice.key)}
            />
          ))}
        </svg>
        {/* The hole's text, as HTML so it stays crisp and wraps. The amount
            stands alone, so it keeps proportional figures (tabular ones
            look loose at this size). */}
        <div className="pointer-events-none absolute inset-[24%] flex flex-col items-center justify-center text-center">
          <span className="line-clamp-2 text-xs text-muted-foreground">{selected ? selected.label : totalLabel}</span>
          <span className="text-lg font-semibold leading-tight sm:text-xl">
            {numberFormat.format(selected ? selected.value : total)}
          </span>
          {selected && (
            <span className="text-xs text-muted-foreground">
              {format(dict.share, { percent: percentOf(selected.value) })}
            </span>
          )}
        </div>
      </div>

      {selected ? (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          {/* What the picked slice says, read out when it changes. */}
          <div role="status" className="flex flex-col gap-1">
            {selected.notes?.map((note) => (
              <p
                key={note.text}
                className={"flex items-start gap-1.5 " + (note.tone ? `font-medium ${TONE_TEXT[note.tone]}` : "text-muted-foreground")}
              >
                {note.tone && <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {note.text}
              </p>
            ))}
          </div>
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

      {/* The key, and the way to pick a slice without aiming at it. The
          text stays full strength whatever is picked (dimming it dropped it
          below 4.5:1); the swatches carry the emphasis. */}
      <ul className="flex flex-col">
        {slices.map((slice) => {
          const isSelected = slice.key === selectedKey;
          return (
            <li key={slice.key}>
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(slice.key)}
                className={
                  "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 " +
                  (isSelected ? "bg-muted" : "hover:bg-muted/60")
                }
              >
                <span aria-hidden className={`size-3 shrink-0 rounded-[3px] ${fill(slice)}`} />
                <span className="min-w-0 truncate">{slice.label}</span>
                {slice.status && (
                  <span className={`flex shrink-0 items-center ${TONE_TEXT[slice.status]}`}>
                    <TriangleAlert className="size-4" aria-hidden />
                    <span className="sr-only">
                      {slice.status === "destructive" ? dict.overLimit : dict.nearLimit}
                    </span>
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
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
