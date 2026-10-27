// Pure portion arithmetic and payload schemas for GAP-49's meal prep —
// split out from the (future) "use server" action files, which may only
// export async functions, so the rules are unit-testable without mocking
// Prisma, same as leftovers.ts.

import { z } from "zod";
import { v } from "@/lib/actions/errors";
import { getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { LEFTOVERS_SHELF_LIFE_DAYS, MAX_LEFTOVER_SERVINGS } from "@/app/dashboard/meal-planning/leftover-constants";
import { MEAL_TYPES } from "@/app/dashboard/meal-planning/meal-types";
import type { AutoAddedItem } from "@/lib/shopping/default-list";

// One prep session rarely covers more than a handful of dishes; the cap also
// bounds the transaction (one stock deduction per recipe) and the undo payload.
export const MAX_PREP_DISHES = 5;

// At most 28 slots in one assignment: a full week of four meals a day.
const MAX_ASSIGN_SLOTS = 28;

// Same sanity bound as recipe-actions.ts / cooking-actions.ts. Kept local
// until the constant moves into a shared module, so the echoed undo payload
// can't carry a quantity those actions would never have produced.
const MAX_INGREDIENT_QUANTITY = 1_000_000;

const DAY_MS = 24 * 60 * 60 * 1000;

// A real calendar date, not just the `yyyy-mm-dd` shape ("2026-02-31" would
// roll over inside `new Date()`), as in planner-actions.ts.
const dateKey = z
  .string()
  .refine(
    (key) => isDateKey(key) && toDateKey(parseDateKey(key)) === key,
    v("invalidDate"),
  );

// A week key must be a real `yyyy-mm-dd` date *and* a Monday. The planner
// only ever addresses weeks by their Monday (see getWeekStart), and a
// non-Monday key here would re-date entries onto the wrong days and write a
// MealPlan row whose weekStartDate no page view would ever look up. Shared
// by planner-actions.ts (copy week, fill empty days) and prep-actions.ts
// (the Plan portions dialog's week read); it lives here because a
// "use server" file may only export async functions.
export const weekKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidWeek"))
  .refine((key) => {
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && toDateKey(getWeekStart(date)) === key;
  }, v("invalidWeek"));

// Strict ISO instant, as produced by Date#toISOString — the undo/discard
// payloads round-trip through the client, so reject anything else.
const isoInstant = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && !Number.isNaN(Date.parse(s)),
    v("invalidDate"),
  );

export const recordPrepSchema = z
  .array(
    z.object({
      recipeId: z.string().min(1),
      portions: z.coerce
        .number(v("prepPortionsInvalid"))
        .int(v("prepPortionsInvalid"))
        .min(1, v("prepPortionsInvalid"))
        .max(MAX_LEFTOVER_SERVINGS, v("prepPortionsInvalid")),
      expiryDate: dateKey.optional(),
    }),
  )
  .min(1, v("prepTooManyDishes"))
  .max(MAX_PREP_DISHES, v("prepTooManyDishes"));

export const assignPortionsSchema = z.object({
  batchId: z.string().min(1),
  slots: z
    .array(
      z.object({
        date: dateKey,
        mealType: z.enum(MEAL_TYPES),
        portions: z
          .number()
          .int(v("prepPortionsInvalid"))
          .min(1, v("prepPortionsInvalid"))
          .max(MAX_LEFTOVER_SERVINGS, v("prepPortionsInvalid")),
      }),
    )
    .min(1)
    .max(MAX_ASSIGN_SLOTS)
    // A slot listed twice would create two entries for one meal; the caller
    // should merge the portions instead.
    .refine(
      (slots) => new Set(slots.map((s) => `${s.date}|${s.mealType}`)).size === slots.length,
      v("invalidValue"),
    ),
});

/**
 * When a batch cooked at `cookedAt` should be eaten by: the leftovers shelf
 * life later, to the millisecond. Exact 24h steps (not calendar days) so the
 * time of day is preserved and DST can't shift it.
 */
export function defaultBatchExpiry(cookedAt: Date): Date {
  return new Date(cookedAt.getTime() + LEFTOVERS_SHELF_LIFE_DAYS * DAY_MS);
}

/** Sum of portions requested across slots. */
export function totalRequested(slots: { portions: number }[]): number {
  return slots.reduce((sum, s) => sum + s.portions, 0);
}

/**
 * Portions left after giving `returned` back (an unplanned or deleted
 * entry). Capped at `total` so a double-return can't invent portions, and a
 * negative `returned` is ignored rather than silently consuming stock.
 */
export function portionsAfterReturn(remaining: number, total: number, returned: number): number {
  return Math.min(total, remaining + Math.max(0, returned));
}

/**
 * A batch stays visible while it has portions left or is still planned
 * somewhere — an empty but planned batch is still tomorrow's dinner. The
 * caller passes the count of uneaten linked entries, so a batch whose last
 * planned meals have all been eaten drops off.
 */
export function isActiveBatch(remaining: number, linkedEntryCount: number): boolean {
  return remaining > 0 || linkedEntryCount > 0;
}

export type PrepUndo = {
  batchIds: string[];
  rows: { itemId: string; quantity: number }[];
  autoAdded: AutoAddedItem[];
};

// The undo payload is echoed back from the client, so it is re-validated
// like any other input (and the household scope is applied by the action).
export const prepUndoSchema = z.object({
  batchIds: z.array(z.string().min(1)).min(1).max(MAX_PREP_DISHES),
  rows: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().finite().positive().max(MAX_INGREDIENT_QUANTITY),
      }),
    )
    .max(500),
  autoAdded: z
    .array(
      z.object({
        shoppingListItemId: z.string().min(1),
        listId: z.string().min(1),
        listName: z.string(),
        itemName: z.string(),
      }),
    )
    .max(500),
});

export type DiscardSnapshot = {
  batch: {
    id: string;
    recipeId: string;
    // Null once the cook has left the household (PreparedBatch's SetNull).
    cookedByMemberId: string | null;
    totalPortions: number;
    remainingPortions: number;
    cookedAt: string;
    expiryDate: string | null;
  };
  // `consumed`: the entry was already eaten when the batch was discarded,
  // so its portions were spent then (see undoDiscardBatchAction).
  entries: { id: string; portions: number; consumed: boolean }[];
};

export const discardSnapshotSchema = z.object({
  batch: z.object({
    id: z.string().min(1),
    recipeId: z.string().min(1),
    cookedByMemberId: z.string().min(1).nullable(),
    totalPortions: z.number().int().min(1).max(MAX_LEFTOVER_SERVINGS),
    remainingPortions: z.number().int().min(0).max(MAX_LEFTOVER_SERVINGS),
    cookedAt: isoInstant,
    expiryDate: isoInstant.nullable(),
  })
    // Restoring a batch with more left than was cooked would invent portions.
    .refine((b) => b.remainingPortions <= b.totalPortions, v("invalidValue")),
  entries: z
    .array(
      z.object({
        id: z.string().min(1),
        portions: z.number().int().min(1).max(MAX_LEFTOVER_SERVINGS),
        consumed: z.boolean(),
      }),
    )
    .max(MAX_ASSIGN_SLOTS * 4),
});
