// Pure helpers for GAP-8's leftover tracking on "mark meal as cooked" —
// split out from cooking-actions.ts (a "use server" file, which may only
// export async functions) so the validation rules are unit-testable without
// mocking Prisma, same as cooked-ingredients.ts. Since GAP-49 the leftovers
// are a PreparedBatch, written in markMealEntryCookedAction's transaction.

import { z } from "zod";
import { MAX_LEFTOVER_SERVINGS } from "@/app/dashboard/meal-planning/leftover-constants";
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

// MAX_LEFTOVER_SERVINGS lives in leftover-constants.ts (zod-free, imported
// by client dialogs).

// Empty (the default — the field starts blank) means "no leftovers", same
// as 0: the Guardrails' "suggest, don't silently mutate" rule means a
// leftovers batch is only ever created when the household typed a number.
// Whole servings only — "half a serving left" isn't worth tracking, and a
// batch counts whole portions.
export const leftoverServingsSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? 0 : value),
  z.coerce.number().int().min(0).max(MAX_LEFTOVER_SERVINGS),
);

// What markMealEntryCookedAction recorded for leftovers, handed back to
// MarkCookedDialog so the toast's Undo can delete the batch it created.
export type LeftoversChange = { batchId: string };

// Validates the change the client echoes back into
// undoMarkMealEntryCookedAction. The delete is still re-scoped to the
// caller's household, so a tampered id matches nothing of anyone else's.
export const leftoversChangeSchema = z.object({ batchId: z.string().min(1) });

// GAP-39: how far past the cook date the "Plan leftovers" prompt looks for a
// dinner-free day. Two months is far beyond any real plan; it only bounds
// the query suggestLeftoversDayAction runs.
export const LEFTOVERS_DAY_SEARCH_DAYS = 60;

/**
 * The first day after `afterKey` (yyyy-mm-dd) that isn't in `dinnerDateKeys`
 * — the day "Plan leftovers" prefills. Strictly after, since leftovers are
 * eaten on a later day than the cook. It only ever suggests: the dialog
 * lets the household change the day, and nothing is written until they
 * confirm. If every day in the search window already has a dinner it
 * returns the day just past the window (which the caller never queried, so
 * it's unchecked but harmless: adding a meal never replaces another).
 */
export function nextFreeDinnerDay(afterKey: string, dinnerDateKeys: Iterable<string>): string {
  const taken = new Set(dinnerDateKeys);
  const start = parseDateKey(afterKey);
  for (let offset = 1; offset <= LEFTOVERS_DAY_SEARCH_DAYS; offset++) {
    const key = toDateKey(addDays(start, offset));
    if (!taken.has(key)) return key;
  }
  return toDateKey(addDays(start, LEFTOVERS_DAY_SEARCH_DAYS + 1));
}
