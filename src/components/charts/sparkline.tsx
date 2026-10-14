// UX-39: a word-sized trend line — the per-category spending sparkline in
// CategoryBreakdown and the price trend in CostAnalyzer. Plain inline SVG
// (no chart library; the whole chart kit here is a few hundred lines) that
// stretches to its box, with `non-scaling-stroke` so the line stays the
// same weight however wide the box gets.
//
// A sparkline is a picture of numbers that are said elsewhere, so it carries
// them as its accessible name (`label`) rather than a table: one image, one
// sentence, read once.

import { chartStroke } from "@/components/charts/chart-colors";

export function Sparkline({
  points,
  colorIndex = 0,
  label,
  className = "h-12 w-full",
}: {
  points: number[];
  /** Which chart token (0 = chart-1) to draw in — the row's own colour. */
  colorIndex?: number;
  /** The values in words, for screen readers. */
  label: string;
  className?: string;
}) {
  const width = 100;
  const height = 24;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((value, i) => ({
    x: pad + i * stepX,
    // A flat series sits mid-height rather than on the floor.
    y: max === min ? height / 2 : height - pad - ((value - min) / range) * (height - pad * 2),
  }));
  const last = coords[coords.length - 1];
  const stroke = chartStroke(colorIndex);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline
        points={coords.map((c) => `${c.x},${c.y}`).join(" ")}
        fill="none"
        className={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The latest point gets a dot: "this month" is the one to read. A
          zero-length round-capped line stays a circle under the stretch,
          which a <circle> wouldn't. */}
      {last && (
        <line
          x1={last.x}
          y1={last.y}
          x2={last.x}
          y2={last.y}
          className={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
