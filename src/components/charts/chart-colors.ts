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

