// UX-39: the projected end-of-month line on Safe to spend. The solid line
// is what's been safe to spend each day so far this month; from today a
// dashed line carries on at the same everyday pace to the last day (the
// maths is projectMonthEnd in src/lib/chart-calc.ts). The sentence under
// it says the same thing in words, so the chart is never the only way to
// read the number; screen readers get both values as a visually hidden
// table, and the SVG itself is hidden from them.
//
// Server-safe (no state): a line with two numbers on it has nothing to tap
// for — both are printed. Inline SVG in chart-1, the first chart token.

import { TriangleAlert } from "lucide-react";
import { format } from "@/lib/i18n/format";
import type { MonthProjection } from "@/lib/chart-calc";

export type ProjectionDict = {
  projectionTitle: string;
  projectionLeft: string;
  projectionOver: string;
  projectionPace: string;
  projectionToday: string;
  projectionMonthEnd: string;
  projectionCaption: string;
};

const WIDTH = 100;
const HEIGHT = 40;
const PAD = 3;

export function ProjectionChart({
  projection,
  numberFormat,
  dict,
}: {
  projection: MonthProjection;
  numberFormat: Intl.NumberFormat;
  dict: ProjectionDict;
}) {
  const { daysInMonth, daysElapsed, start, actual, dailyPace, projected } = projection;
  const today = actual[actual.length - 1];
  const values = [start, ...actual, projected];
  // Scaled to the line itself, not from zero: a healthy month whose
  // balance moves a few percent would otherwise draw as a flat line along
  // the top. Zero only enters the scale (and gets a baseline) once the
  // line actually goes below it.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (day: number) => PAD + (day / daysInMonth) * (WIDTH - PAD * 2);
  const y = (value: number) => HEIGHT - PAD - ((value - min) / range) * (HEIGHT - PAD * 2);

  const solid = [`${x(0)},${y(start)}`, ...actual.map((v, i) => `${x(i + 1)},${y(v)}`)].join(" ");
  const over = projected < 0;
  // The "Today" tick sits under today's point, kept off the card's edges.
  const todayLeft = Math.min(82, Math.max(18, (x(daysElapsed) / WIDTH) * 100));
  // Both labels now carry an amount, so they're about twice as wide: past
  // the middle "Month end" drops to a second line (right-aligned under the
  // line's end) instead of colliding with "Today".
  const stacked = todayLeft > 45;

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">{dict.projectionTitle}</p>
      <div aria-hidden className="relative">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-16 w-full">
          {min < 0 && max > 0 && (
            <line
              x1={PAD}
              x2={WIDTH - PAD}
              y1={y(0)}
              y2={y(0)}
              className="stroke-border"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polyline
            points={solid}
            fill="none"
            className="stroke-chart-1"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(daysElapsed)}
            y1={y(today)}
            x2={x(daysInMonth)}
            y2={y(projected)}
            className="stroke-chart-1"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(daysElapsed)}
            y1={y(today)}
            x2={x(daysElapsed)}
            y2={y(today)}
            className="stroke-chart-1"
            strokeWidth="6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="relative text-xs text-muted-foreground">
          <div className="relative h-4">
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${todayLeft}%` }}>
              {dict.projectionToday} <span className="tabular-nums">{numberFormat.format(today)}</span>
            </span>
            {!stacked && (
              <span className="absolute right-0 whitespace-nowrap">
                {dict.projectionMonthEnd} <span className="tabular-nums">{numberFormat.format(projected)}</span>
              </span>
            )}
          </div>
          {stacked && (
            <p className="text-right">
              {dict.projectionMonthEnd} <span className="tabular-nums">{numberFormat.format(projected)}</span>
            </p>
          )}
        </div>
      </div>
      {/* UX-138: a qualifier on the headline above, not a second "left"
          figure: it keeps body size (DESIGN.md M9) and gets its lower rank
          from muted colour and its place under the headline, red only when
          the month ends in the red. */}
      <p className={"flex items-start gap-1.5 text-sm " + (over ? "text-destructive" : "text-muted-foreground")}>
        {over && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <span>
          {format(over ? dict.projectionOver : dict.projectionLeft, {
            amount: numberFormat.format(Math.abs(projected)),
          })}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        {format(dict.projectionPace, { amount: numberFormat.format(dailyPace) })}
      </p>
      {/* The table sits in an sr-only div rather than being sr-only
          itself: a table never shrinks below its content, so a 1 px
          `sr-only` table still widened the page (horizontal scroll). */}
      <div className="sr-only">
        <table>
          <caption>{dict.projectionCaption}</caption>
          <tbody>
            <tr>
              <th scope="row">{dict.projectionToday}</th>
              <td>{numberFormat.format(today)}</td>
            </tr>
            <tr>
              <th scope="row">{dict.projectionMonthEnd}</th>
              <td>{numberFormat.format(projected)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
