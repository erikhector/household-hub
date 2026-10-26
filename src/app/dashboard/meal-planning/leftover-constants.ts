// Leftover constants shared with client dialogs. Kept apart from leftovers.ts
// because that file defines zod schemas, and a client import of it would pull
// zod into the meal-planning bundle (PERF-24).

// Leftovers get a flat ~3-day estimate — the conservative end of the usual
// "3–4 days in the fridge" guidance for cooked food, and the same number
// shelf-life.ts's SHELF_LIFE_CATEGORY_DEFAULTS already uses for meat (the
// most perishable category it estimates). It's every batch's default eat-by
// date (defaultBatchExpiry in prepared-batch-calc.ts), leftovers included.
export const LEFTOVERS_SHELF_LIFE_DAYS = 3;

// A generous sanity cap, not a real-world limit — nobody puts 100+ servings
// of one dish in the fridge, and it keeps a typo ("40" for "4" is plausible,
// "4000" isn't) from creating a nonsense batch.
export const MAX_LEFTOVER_SERVINGS = 100;
