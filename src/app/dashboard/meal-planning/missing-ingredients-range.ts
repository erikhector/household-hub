// The date range the meal-plan → shopping-list bridge works over, split out
// of missing-ingredients.ts so the client MissingIngredientsDialog can import
// it. It is deliberately free of `zod` (PERF-7, PERF-24): a client import of
// the schema-bearing module put ~30 KB gz into the meal-planning page. The
// validation is hand-written for that reason; client-bundle-guard.test.ts
// fails if a path to zod comes back.

import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// --- Date range (GAP-32) -----------------------------------------------------
//
// The bridge used to be hard-scoped to one MealPlan.weekStartDate. It now
// takes any half-open `[from, to)` range of `yyyy-mm-dd` day keys, so a
// household can build one shopping list for e.g. the next two weeks before a
// big trip (the Plan to Eat / Mealime pattern). "This week" is simply
// `[weekStart, weekStart + 7)` — see weekRange below. Half-open so adjacent
// ranges never double-count a day, and so it maps 1:1 onto a Prisma
// `{ gte, lt }` filter on MealPlanEntry.date.
//
// Capped at 31 days: long enough for "the whole month" or two weeks away,
// short enough that one preview can't fan out into expanding hundreds of
// planned recipes (each entry is its own recursive expandRecipeIngredients
// walk). The dialog validates the same way before calling, but the server
// action is what enforces it — a Server Action is a public endpoint.
export const MAX_MISSING_INGREDIENTS_RANGE_DAYS = 31;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A real calendar day, not just the right shape — "2026-02-31" matches the
// regex, but `new Date` would silently roll it over into March.
function parseDayKey(key: unknown): Date | null {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = parseDateKey(key);
  return !Number.isNaN(date.getTime()) && toDateKey(date) === key ? date : null;
}

// `to` is exclusive — see the half-open note above.
export type MissingIngredientsRange = { from: string; to: string };

// Parses an untrusted `{ from, to }` into UTC-midnight Dates, or null when
// it isn't a non-empty range of at most MAX_MISSING_INGREDIENTS_RANGE_DAYS
// days. Shared by previewMissingIngredientsAction and the dialog's
// custom-range inputs so both agree on what's valid.
export function parseMissingIngredientsRange(input: unknown): { from: Date; to: Date } | null {
  if (typeof input !== "object" || input === null) return null;
  const from = parseDayKey((input as { from?: unknown }).from);
  const to = parseDayKey((input as { to?: unknown }).to);
  if (!from || !to) return null;
  const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  return days >= 1 && days <= MAX_MISSING_INGREDIENTS_RANGE_DAYS ? { from, to } : null;
}

// The visible planner week as a range — the dialog's default, and exactly
// the single MealPlan the bridge was scoped to before GAP-32.
export function weekRange(weekStartKey: string): MissingIngredientsRange {
  return { from: weekStartKey, to: toDateKey(addDays(parseDateKey(weekStartKey), 7)) };
}
