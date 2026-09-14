// Pure aggregation logic for the meal-planning "variety recap" (see
// JOY_GAP_BACKLOG.md item 5) — split out from page.tsx so it's unit-testable
// without Prisma, mirroring missing-ingredients.ts/cooked-ingredients.ts.
// Counts distinct recipes cooked/planned across a trailing window, framed as
// variety rather than a score: a freeform entry (no linked recipe) doesn't
// count towards the total, since there's no recipe identity to dedupe by,
// and a quiet window is meant to produce zero, not a penalty.

export type MealVarietyEntry = {
  date: Date;
  recipeId: string | null;
};

const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Distinct recipe count across the `windowDays` (default 30) ending at
 * `now`, inclusive of both ends. Freeform entries and dates outside the
 * window are ignored.
 */
export function computeMealVarietyRecap({
  entries,
  now,
  windowDays = DEFAULT_WINDOW_DAYS,
}: {
  entries: MealVarietyEntry[];
  now: Date;
  windowDays?: number;
}): { distinctRecipeCount: number } {
  const windowStart = new Date(now.getTime() - windowDays * MS_PER_DAY);
  const recipeIds = new Set<string>();

  for (const entry of entries) {
    if (entry.recipeId === null) continue;
    if (entry.date < windowStart || entry.date > now) continue;
    recipeIds.add(entry.recipeId);
  }

  return { distinctRecipeCount: recipeIds.size };
}
