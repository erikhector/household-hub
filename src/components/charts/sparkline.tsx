// UX-39: a word-sized trend line — the per-category spending sparkline in
// CategoryBreakdown and the price trend in CostAnalyzer. Plain inline SVG
// (no chart library; the whole chart kit here is a few hundred lines) that
// stretches to its box, with `non-scaling-stroke` so the line stays the
// same weight however wide the box gets.
//
// Chart redesign (Oct 2026): the line is one quiet de-emphasis colour and
// only this month's point carries the accent, so a column of sparklines reads
// as one thing — "is this month high for this row?" — rather than a rainbow.
// They used to take chart-1 … chart-5 by row position, which coloured a row
// by its rank (it repainted whenever the order changed) and cycled past five.
//
// A sparkline is a picture of numbers that are said elsewhere, so it carries
// them as its accessible name (`label`) rather than a table: one image, one
// sentence, read once.

export function Sparkline({
  points,
  label,
  className = "h-12 w-full",
}: {
  points: number[];
  /** The values in words, for screen readers. */
  label: string;
  className?: string;
}) {
  const width = 100;
  const height = 24;
  const pad = 3;
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
        className="stroke-muted-foreground/45"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The latest point is "this month", the one to read: a dot in the
          accent with a ring of the card's colour so it stands off the line.
          Zero-length round-capped lines stay circles under the stretch,
          which a <circle> wouldn't. */}
      {last && (
        <>
          <line
            x1={last.x}
            y1={last.y}
            x2={last.x}
            y2={last.y}
            className="stroke-card"
            strokeWidth="9"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={last.x}
            y1={last.y}
            x2={last.x}
            y2={last.y}
            className="stroke-primary"
            strokeWidth="5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}
