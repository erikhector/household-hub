// UX-39: the one place chart marks get their colour. DESIGN.md, Colour:
// "Charts take chart-1 … chart-5 in order" and those tokens are for marks,
// never text. Literal class names (not `bg-chart-${n}`) so Tailwind's
// scanner generates every one of them.

export const CHART_FILL = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

/** The fill class for series or row `index`, cycling past five. */
export function chartFill(index: number): string {
  return CHART_FILL[index % CHART_FILL.length];
}

// Design review (Oct 2026): one page used teal for Transport (donut), Saved
// (split bar) and Left over (fixed chart), so a colour learnt in one chart
// meant something else in the next. Money flows now have one fixed colour
// each, wherever they're drawn: the Safe to spend split bar, the fixed
// income chart and the savings goals meters. Left over is the green
// `success` is a text step of, so "left" reads as the good part. Categories
// never take these: the donut uses the emphasis pair below instead.

/** The fixed colour of each money flow. "kept" (money held back for a
 * category limit) is a lighter step of "due": both are already promised. */
export const FLOW_FILL = {
  spent: "bg-chart-1",
  saved: "bg-chart-3",
  due: "bg-chart-2",
  kept: "bg-chart-2/45",
  left: "bg-chart-5",
} as const;

// Emphasis (dataviz "highlight one, grey the rest"): for charts whose story
// is one item against its context, not every item's identity — the donut's
// picked (or largest) slice, and "this month" against last on "at a glance".
// The accent is chart-4, the brand purple tuned for marks, which no money
// flow uses, so it never collides with FLOW_FILL on the same page.
export const EMPHASIS_FILL = "bg-chart-4";
export const EMPHASIS_STROKE = "stroke-chart-4";
export const CONTEXT_FILL = "bg-muted-foreground/40";
export const CONTEXT_STROKE = "stroke-muted-foreground/40";
