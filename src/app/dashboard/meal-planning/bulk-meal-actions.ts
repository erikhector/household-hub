"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { BatchChangedError, returnEntryPortionsInTx } from "@/app/dashboard/meal-planning/prep-assign";
import { canMarkEaten, canRePortion, mapBulkMove, splitCooked } from "@/app/dashboard/meal-planning/bulk-meal-calc";
import { clearCookSoon } from "@/app/dashboard/meal-planning/cook-soon";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDate"))
  .refine((key) => {
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && toDateKey(date) === key;
  }, v("invalidDate"));

// Well above a real week (7 days x 4 slots with stacked entries); it only
// stops a crafted call from sending an unbounded id list.
const entryIdsSchema = z.array(z.string().min(1)).min(1).max(200);

const bulkSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move"),
    entryIds: entryIdsSchema,
    date: dateKeySchema,
    // null keeps each meal's own slot.
    mealType: z.enum(MEAL_TYPES).nullable(),
  }),
  z.object({
    op: z.literal("portions"),
    entryIds: entryIdsSchema,
    portions: z.number().int().min(1, v("portionsMin")).max(1_000),
  }),
  z.object({ op: z.literal("remove"), entryIds: entryIdsSchema }),
  z.object({ op: z.literal("eaten"), entryIds: entryIdsSchema }),
]);

export type BulkMealEdit = z.input<typeof bulkSchema>;

/** What an Undo needs to put one entry back (only the fields the edit changed). */
export type BulkMealRestore = {
  id: string;
  date?: string;
  mealType?: MealType;
  portions?: number;
};

export type BulkMealResult = ActionState & {
  changed?: number;
  /** Cooked (or, for portions, not re-portionable) meals left alone. */
  skipped?: number;
  restore?: BulkMealRestore[];
  /** The meals a bulk "Mark eaten" marked, for its Undo. */
  eatenIds?: string[];
};

// GAP-56: one Server Action for the planner's Select mode. All-or-nothing in
// two ways: an id that isn't this household's (or doesn't exist) rejects the
// whole batch before anything is written, and the writes share one
// transaction. Cooked meals are the exception, and only by being skipped:
// their day, slot and portions record what was eaten (see
// moveMealEntryAction), and a selection made before another member marked
// one cooked shouldn't fail for that. The household comes from the session;
// the client sends entry ids and the edit, never a household id or week key
// (the target week is derived from the picked date, as moveMealEntryAction
// does).
export async function bulkEditMealEntriesAction(input: BulkMealEdit): Promise<BulkMealResult> {
  const { household } = await requireHousehold();

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return await zodFail(parsed.error);
  const edit = parsed.data;

  const ids = [...new Set(edit.entryIds)];
  const rows = await prisma.mealPlanEntry.findMany({
    where: { id: { in: ids }, mealPlan: { householdId: household.id } },
    select: {
      id: true,
      date: true,
      mealType: true,
      portions: true,
      recipeId: true,
      consumedAt: true,
      preparedBatchId: true,
      preparedPortionsUsed: true,
    },
  });
  if (rows.length !== ids.length) return await fail("mealNotFound");

  const entries = rows.map((row) => ({ ...row, date: toDateKey(row.date) }));
  const { editable, skipped: cooked } = splitCooked(entries);

  if (edit.op === "move") {
    if (editable.length === 0) return await fail("bulkNothingToChange");
    const moves = mapBulkMove(editable, edit.date, edit.mealType);
    const weekKeys = [...new Set(moves.map((m) => toDateKey(getWeekStart(parseDateKey(m.date)))))];
    try {
      await prisma.$transaction(async (tx) => {
        const planIds = new Map<string, string>();
        for (const weekKey of weekKeys) {
          const weekStartDate = parseDateKey(weekKey);
          const plan = await tx.mealPlan.upsert({
            where: { householdId_weekStartDate: { householdId: household.id, weekStartDate } },
            update: {},
            create: { householdId: household.id, weekStartDate },
          });
          planIds.set(weekKey, plan.id);
        }
        for (const move of moves) {
          const date = parseDateKey(move.date);
          // Guarded like the remove path: a meal cooked since the read
          // above keeps the day it was eaten, and fails the batch.
          const moved = await tx.mealPlanEntry.updateMany({
            where: { id: move.id, consumedAt: null },
            data: {
              mealPlanId: planIds.get(toDateKey(getWeekStart(date)))!,
              date,
              mealType: move.mealType,
            },
          });
          if (moved.count === 0) throw new BatchChangedError();
        }
        // A moved meal answers its "Meal not logged" reminder, as in
        // moveMealEntryAction.
        await tx.notification.updateMany({
          where: {
            householdId: household.id,
            mealPlanEntryId: { in: moves.map((m) => m.id) },
            kind: "MEAL_NOT_LOGGED",
            dismissedAt: null,
          },
          data: { dismissedAt: new Date() },
        });
      });
    } catch (error) {
      if (error instanceof BatchChangedError) return await fail("generic");
      return toFriendlyError(error);
    }
    revalidatePath(MEAL_PLANNING_PATH);
    const before = new Map(editable.map((e) => [e.id, e]));
    return {
      changed: moves.length,
      skipped: cooked,
      restore: moves.map((m) => ({
        id: m.id,
        date: before.get(m.id)!.date,
        mealType: before.get(m.id)!.mealType,
      })),
    };
  }

  if (edit.op === "portions") {
    const targets = editable.filter(canRePortion);
    if (targets.length === 0) return await fail("bulkNothingToChange");
    try {
      await prisma.mealPlanEntry.updateMany({
        where: { id: { in: targets.map((t) => t.id) }, consumedAt: null, preparedBatchId: null },
        data: { portions: edit.portions },
      });
    } catch (error) {
      return toFriendlyError(error);
    }
    revalidatePath(MEAL_PLANNING_PATH);
    return {
      changed: targets.length,
      skipped: entries.length - targets.length,
      restore: targets.map((t) => ({ id: t.id, portions: t.portions })),
    };
  }

  if (edit.op === "eaten") {
    const targets = editable.filter(canMarkEaten);
    if (targets.length === 0) return await fail("bulkNothingToChange");
    try {
      await prisma.$transaction(async (tx) => {
        // Guarded like the single mark: a meal eaten, or unlinked to cook
        // fresh, since the read above fails the batch rather than being
        // marked without its ingredients coming off.
        const marked = await tx.mealPlanEntry.updateMany({
          where: { id: { in: targets.map((t) => t.id) }, consumedAt: null, preparedBatchId: { not: null } },
          data: { consumedAt: new Date() },
        });
        if (marked.count !== targets.length) throw new BatchChangedError();
        // GAP-51: eaten, so off the Cook soon shelf, as markMealEntryCookedAction does.
        for (const recipeId of new Set(targets.map((t) => t.recipeId))) {
          await clearCookSoon(tx, household.id, recipeId);
        }
      });
    } catch (error) {
      if (error instanceof BatchChangedError) return await fail("generic");
      return toFriendlyError(error);
    }
    revalidatePath(MEAL_PLANNING_PATH);
    revalidatePath("/dashboard");
    return {
      changed: targets.length,
      skipped: entries.length - targets.length,
      eatenIds: targets.map((t) => t.id),
    };
  }

  // remove: an uneaten meal planned from a batch gives its portions back,
  // like deleteMealEntryAction, all in one transaction so a batch that moved
  // under us rolls the whole removal back.
  if (editable.length === 0) return await fail("bulkNothingToChange");
  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of editable) {
        // Guarded on what was just read, so a meal cooked or re-linked in
        // the meantime fails the batch instead of being deleted.
        const deleted = await tx.mealPlanEntry.deleteMany({
          where: {
            id: entry.id,
            consumedAt: null,
            preparedBatchId: entry.preparedBatchId,
            preparedPortionsUsed: entry.preparedPortionsUsed,
          },
        });
        if (deleted.count === 0) throw new BatchChangedError();
        await returnEntryPortionsInTx(tx, household.id, entry);
      }
    });
  } catch (error) {
    if (error instanceof BatchChangedError) return await fail("generic");
    return toFriendlyError(error);
  }
  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return { changed: editable.length, skipped: cooked };
}

const restoreSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      date: dateKeySchema.optional(),
      mealType: z.enum(MEAL_TYPES).optional(),
      portions: z.number().int().min(1).max(1_000).optional(),
    }),
  )
  .min(1)
  .max(200);

// The Undo on the bulk move / portions toast: puts back the fields the edit
// changed. Same all-or-nothing tenancy rule (a foreign id rejects the lot).
// A meal cooked since is left as it is: it is real now, and moving it back
// would rewrite when it was eaten.
export async function undoBulkMealEditAction(restore: BulkMealRestore[]): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = restoreSchema.safeParse(restore);
  if (!parsed.success) return await fail("invalidInput");

  const ids = [...new Set(parsed.data.map((r) => r.id))];
  const rows = await prisma.mealPlanEntry.findMany({
    where: { id: { in: ids }, mealPlan: { householdId: household.id } },
    select: { id: true, consumedAt: true },
  });
  if (rows.length !== ids.length) return await fail("mealNotFound");
  const cooked = new Set(rows.filter((r) => r.consumedAt).map((r) => r.id));
  const todo = parsed.data.filter((r) => !cooked.has(r.id));

  try {
    await prisma.$transaction(async (tx) => {
      const planIds = new Map<string, string>();
      for (const item of todo) {
        const data: { date?: Date; mealType?: MealType; mealPlanId?: string; portions?: number } = {};
        if (item.date) {
          const date = parseDateKey(item.date);
          const weekKey = toDateKey(getWeekStart(date));
          if (!planIds.has(weekKey)) {
            const weekStartDate = parseDateKey(weekKey);
            const plan = await tx.mealPlan.upsert({
              where: { householdId_weekStartDate: { householdId: household.id, weekStartDate } },
              update: {},
              create: { householdId: household.id, weekStartDate },
            });
            planIds.set(weekKey, plan.id);
          }
          data.date = date;
          data.mealPlanId = planIds.get(weekKey);
        }
        if (item.mealType) data.mealType = item.mealType;
        if (item.portions !== undefined) data.portions = item.portions;
        // Re-checked in the write itself: a meal cooked after the read
        // above must not have its eaten date rewritten.
        const restored = await tx.mealPlanEntry.updateMany({ where: { id: item.id, consumedAt: null }, data });
        if (restored.count === 0) throw new BatchChangedError();
      }
    });
  } catch (error) {
    if (error instanceof BatchChangedError) return await fail("generic");
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

// The Undo on the bulk "Mark eaten" toast. Marking a batch meal eaten changed
// nothing but consumedAt (see markMealEntryCookedAction), so that's all this
// puts back, and only on meals still eating from a batch: one unlinked since
// had its ingredients come off when it was cooked fresh, and isn't ours to
// un-cook. Same all-or-nothing tenancy rule as the edit.
export async function undoBulkMarkEatenAction(entryIds: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = entryIdsSchema.safeParse(entryIds);
  if (!parsed.success) return await fail("invalidInput");

  const ids = [...new Set(parsed.data)];
  const found = await prisma.mealPlanEntry.count({
    where: { id: { in: ids }, mealPlan: { householdId: household.id } },
  });
  if (found !== ids.length) return await fail("mealNotFound");

  try {
    await prisma.mealPlanEntry.updateMany({
      where: { id: { in: ids }, preparedBatchId: { not: null }, consumedAt: { not: null } },
      data: { consumedAt: null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}
