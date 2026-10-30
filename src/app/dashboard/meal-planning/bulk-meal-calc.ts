// GAP-56: the pure parts of the planner's bulk edit (move, re-portion,
// remove several planned meals at once). No "use server", no I/O, so the
// day-offset mapping and the skip rules are unit-tested without a database.
import { addDays, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import type { MealType } from "@/app/dashboard/meal-planning/meal-types";

export type BulkEntry = {
  id: string;
  date: string; // yyyy-mm-dd
  mealType: MealType;
  portions: number;
  recipeId: string | null;
  consumedAt: Date | null;
  preparedBatchId: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `fromKey` to `toKey` (UTC midnights, so DST-proof). */
export function dayDiff(fromKey: string, toKey: string): number {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / DAY_MS);
}

/**
 * The entries a bulk edit may touch. A cooked meal's day and slot record
 * when it was eaten, so it is never moved, re-portioned or removed here
 * (the same rule as moveMealEntryAction); it is counted as skipped.
 */
export function splitCooked<T extends Pick<BulkEntry, "consumedAt">>(
  entries: T[],
): { editable: T[]; skipped: number } {
  const editable = entries.filter((entry) => !entry.consumedAt);
  return { editable, skipped: entries.length - editable.length };
}

/**
 * Re-portioning only means something for a recipe meal that cooks fresh: a
 * freeform meal has nothing to scale, and one eating from a prepared batch
 * holds that batch's portions (changing the count would need an unlink).
 */
export function canRePortion(entry: Pick<BulkEntry, "recipeId" | "preparedBatchId">): boolean {
  return entry.recipeId !== null && entry.preparedBatchId === null;
}

/**
 * Bulk "Mark eaten" only takes meals eating from a prepared batch: they were
 * cooked at prep time, so eating one only records that (the same rule as
 * markMealEntryCookedAction for a linked entry). A meal that cooks fresh
 * takes its ingredients off inventory through the review checklist, one
 * meal at a time, and a custom meal can't be marked at all.
 */
export function canMarkEaten(entry: Pick<BulkEntry, "preparedBatchId">): boolean {
  return entry.preparedBatchId !== null;
}

/**
 * "Move to…" for a group: the earliest selected meal lands on `targetDate`
 * and every other one keeps its distance from it, so the group keeps its
 * shape (Mon/Tue/Thu moved to start on Wednesday becomes Wed/Thu/Sat). A
 * null `mealType` keeps each meal's own slot.
 */
export function mapBulkMove(
  entries: Pick<BulkEntry, "id" | "date" | "mealType">[],
  targetDate: string,
  mealType: MealType | null,
): { id: string; date: string; mealType: MealType }[] {
  if (entries.length === 0) return [];
  const earliest = entries.reduce((min, entry) => (entry.date < min ? entry.date : min), entries[0].date);
  const offset = dayDiff(earliest, targetDate);
  return entries.map((entry) => ({
    id: entry.id,
    date: toDateKey(addDays(parseDateKey(entry.date), offset)),
    mealType: mealType ?? entry.mealType,
  }));
}
