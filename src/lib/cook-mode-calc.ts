// GAP-42 — pure helpers for the recipe "Cook" view
// (src/components/meal-planning/cook-mode-dialog.tsx).

// A recipe's instructions are plain text, one step per line (see "Recipe
// import from URL" in REQUIREMENTS.md). Blank lines are separators, not steps.
export function splitSteps(instructions: string | null | undefined): string[] {
  if (!instructions) return [];
  return instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// The factor that turns the recipe's own amounts (which make `servings`
// portions) into amounts for `portions`. Opened from the recipe list there is
// no meal entry, so `portions` is null and amounts stay as written. Guards a
// zero/invalid servings value so the view never shows NaN or Infinity.
export function cookScale(servings: number, portions: number | null): number {
  if (portions == null || !(servings > 0) || !(portions > 0)) return 1;
  return portions / servings;
}

// Scaled amounts are for reading in a kitchen, so two decimals at most and no
// trailing zeros ("0.5", not "0.50"). Intl handles the locale's decimal mark.
export function formatCookQuantity(quantity: number, scale: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(quantity * scale);
}
