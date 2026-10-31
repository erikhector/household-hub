"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { MEAL_TYPES, type MealType } from "@/app/dashboard/meal-planning/meal-types";
import { getWeekStart, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { weekKeySchema } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { clearCookSoon } from "@/app/dashboard/meal-planning/cook-soon";

// Week picks (REQUIREMENTS.md, "Week picks"): meals chosen for a week before
// they're put on a day. A pick lives in MealPlanPick (see its doc comment in
// schema.prisma); placing it moves it into MealPlanEntry and "Back to picks"
// moves it out again, each in one transaction so a meal is never in both
// places or in neither. All click actions (called from a transition), so
// every argument is re-validated here and the household always comes from
// the session.

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

// A week of dinners with room to spare; it only stops a crafted call from
// sending an unbounded list.
const MAX_PICKS_AT_ONCE = 30;

// A real calendar date, not just the `yyyy-mm-dd` shape (same rule as
// moveMealEntryAction's): "2026-02-31" would otherwise roll into March.
const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDate"))
  .refine((key) => {
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && toDateKey(date) === key;
  }, v("invalidDate"));

const idSchema = z.string().min(1).max(100);
const idsSchema = z.array(idSchema).min(1).max(MAX_PICKS_AT_ONCE);

const newPickSchema = z
  .object({
    recipeId: idSchema.nullish(),
    freeformName: z.string().trim().max(120, v("nameTooLong")).nullish(),
    portions: z.number().int().min(1, v("portionsMin")).max(1_000),
  })
  .refine((p) => !!p.recipeId !== !!p.freeformName, v("chooseRecipeOrMeal"));

const addPicksSchema = z.object({
  weekStartDate: weekKeySchema,
  picks: z.array(newPickSchema).min(1).max(MAX_PICKS_AT_ONCE),
});

/**
 * Adds one or more picks to a week (the picker's "Add N meals"). Recipes are
 * checked against the household in one query; the week's MealPlan row is
 * found or created like addMealEntryAction does. Picking a recipe leaves it
 * on Cook soon on purpose: the shelf is cleared when a recipe gets a day or
 * is cooked, and a pick has neither yet. Returns the new ids for the toast's
 * Undo (undoAddPicksAction).
 */
export async function addPicksAction(
  weekStartDate: string,
  picks: { recipeId?: string | null; freeformName?: string | null; portions: number }[],
): Promise<ActionState & { pickIds?: string[] }> {
  const { household, userId } = await requireHousehold();

  const parsed = addPicksSchema.safeParse({ weekStartDate, picks });
  if (!parsed.success) return await zodFail(parsed.error);

  try {
    const recipeIds = [
      ...new Set(parsed.data.picks.flatMap((p) => (p.recipeId ? [p.recipeId] : []))),
    ];
    if (recipeIds.length > 0) {
      const owned = await prisma.recipe.count({ where: { id: { in: recipeIds }, householdId: household.id } });
      if (owned !== recipeIds.length) return await fail("recipeNotFound");
    }

    const weekStart = parseDateKey(parsed.data.weekStartDate);
    const plan = await prisma.mealPlan.upsert({
      where: { householdId_weekStartDate: { householdId: household.id, weekStartDate: weekStart } },
      update: {},
      create: { householdId: household.id, weekStartDate: weekStart },
      select: { id: true },
    });

    const created = await prisma.mealPlanPick.createManyAndReturn({
      data: parsed.data.picks.map((p) => ({
        mealPlanId: plan.id,
        recipeId: p.recipeId ?? null,
        freeformName: p.recipeId ? null : (p.freeformName ?? null),
        portions: p.portions,
        createdByUserId: userId,
      })),
      select: { id: true },
    });

    revalidatePath(MEAL_PLANNING_PATH);
    return { pickIds: created.map((p) => p.id) };
  } catch (error) {
    return toFriendlyError(error);
  }
}

/** The add toast's Undo: deletes exactly those picks, if still unplaced. */
export async function undoAddPicksAction(pickIds: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();
  const parsed = idsSchema.safeParse(pickIds);
  if (!parsed.success) return await fail("invalidInput");

  try {
    await prisma.mealPlanPick.deleteMany({
      where: { id: { in: parsed.data }, mealPlan: { householdId: household.id } },
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

/**
 * "Remove from picks". The tray hides the chip at once and only sends this
 * when the Undo toast closes (createDeferredDelete), so there's no restore
 * action. Already gone (placed or removed elsewhere) is a quiet no-op.
 */
export async function removePickAction(pickId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const parsed = idSchema.safeParse(pickId);
  if (!parsed.success) return await fail("invalidInput");

  try {
    await prisma.mealPlanPick.deleteMany({
      where: { id: parsed.data, mealPlan: { householdId: household.id } },
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

// Thrown inside a placing transaction when a pick has been placed or
// removed since the tray was drawn, so the whole transaction rolls back.
class PickGoneError extends Error {}

type PickRow = { id: string; recipeId: string | null; freeformName: string | null; portions: number };

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// One pick onto one day and slot: the pick is deleted (guarded, so a double
// tap or a second member placing it at the same time can't make two
// entries) and an entry with its dish and portions is created in the
// MealPlan of the date's own week. The week comes from the date, not the
// client, the same rule as moveMealEntryAction, so "Mark as cooked" on a
// pick can date it today even when the tray shows another week.
async function placeInTx(
  tx: TxClient,
  householdId: string,
  pick: PickRow,
  dateKey: string,
  mealType: MealType,
): Promise<string> {
  const removed = await tx.mealPlanPick.deleteMany({ where: { id: pick.id, mealPlan: { householdId } } });
  if (removed.count === 0) throw new PickGoneError();
  const date = parseDateKey(dateKey);
  const weekStartDate = getWeekStart(date);
  const plan = await tx.mealPlan.upsert({
    where: { householdId_weekStartDate: { householdId, weekStartDate } },
    update: {},
    create: { householdId, weekStartDate },
    select: { id: true },
  });
  const entry = await tx.mealPlanEntry.create({
    data: {
      mealPlanId: plan.id,
      date,
      mealType,
      recipeId: pick.recipeId,
      freeformName: pick.recipeId ? null : pick.freeformName,
      portions: pick.portions,
    },
    select: { id: true },
  });
  // GAP-51: a recipe with a day no longer belongs on Cook soon, exactly as
  // when it's added to a day directly (addMealEntryAction).
  await clearCookSoon(tx, householdId, pick.recipeId);
  return entry.id;
}

const placeSchema = z.object({ pickId: idSchema, date: dateKeySchema, mealType: z.enum(MEAL_TYPES) });

/**
 * Places one pick: the place sheet's day rows, a day's "From this week's
 * picks", a drag onto a day, and "Mark as cooked" on a pick (dated today,
 * then the usual Mark as cooked review runs on the new entry). Returns the
 * entry id for the toast's Undo (unplaceEntriesAction) or that review.
 */
export async function placePickAction(
  pickId: string,
  date: string,
  mealType: MealType,
): Promise<ActionState & { entryId?: string }> {
  const { household } = await requireHousehold();
  const parsed = placeSchema.safeParse({ pickId, date, mealType });
  if (!parsed.success) return await zodFail(parsed.error);

  let entryId: string;
  try {
    const pick = await prisma.mealPlanPick.findFirst({
      where: { id: parsed.data.pickId, mealPlan: { householdId: household.id } },
      select: { id: true, recipeId: true, freeformName: true, portions: true },
    });
    if (!pick) return await fail("pickNotFound");
    entryId = await prisma.$transaction((tx) =>
      placeInTx(tx, household.id, pick, parsed.data.date, parsed.data.mealType),
    );
  } catch (error) {
    if (error instanceof PickGoneError) return await fail("pickNotFound");
    return toFriendlyError(error);
  }
  revalidatePath(MEAL_PLANNING_PATH);
  return { entryId };
}

const placeManySchema = z
  .array(z.object({ pickId: idSchema, date: dateKeySchema }))
  .min(1)
  .max(MAX_PICKS_AT_ONCE)
  .refine((rows) => new Set(rows.map((r) => r.pickId)).size === rows.length, v("invalidInput"));

/**
 * "Spread over the week"'s Place all: every accepted row onto its day's
 * dinner, all or nothing. A pick placed elsewhere since the preview opened
 * rolls the whole spread back with "pick not found", so the household sees
 * a fresh preview rather than a half-applied one. Returns the entry ids for
 * the one Undo that takes them all back to the tray.
 */
export async function placePicksAction(
  placements: { pickId: string; date: string }[],
): Promise<ActionState & { entryIds?: string[] }> {
  const { household } = await requireHousehold();
  const parsed = placeManySchema.safeParse(placements);
  if (!parsed.success) return await zodFail(parsed.error);

  let entryIds: string[];
  try {
    const picks = await prisma.mealPlanPick.findMany({
      where: { id: { in: parsed.data.map((p) => p.pickId) }, mealPlan: { householdId: household.id } },
      select: { id: true, recipeId: true, freeformName: true, portions: true },
    });
    const byId = new Map(picks.map((p) => [p.id, p]));
    if (byId.size !== parsed.data.length) return await fail("pickNotFound");
    entryIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const row of parsed.data) {
        ids.push(await placeInTx(tx, household.id, byId.get(row.pickId)!, row.date, "DINNER"));
      }
      return ids;
    });
  } catch (error) {
    if (error instanceof PickGoneError) return await fail("pickNotFound");
    return toFriendlyError(error);
  }
  revalidatePath(MEAL_PLANNING_PATH);
  return { entryIds };
}

/**
 * "Back to picks": planned meals go back to the tray of the week they were
 * planned in, keeping their dish and portions. Also the Undo of a place and
 * of Place all. Only a meal that hasn't been cooked and doesn't eat from a
 * meal-prep batch can go back: a cooked one is a record of what was eaten
 * (moveMealEntryAction refuses it for the same reason), and a prepped one
 * holds batch portions a pick has no way to keep. Those are skipped; if
 * nothing could go back the call fails so the UI can say why.
 */
export async function unplaceEntriesAction(entryIds: string[]): Promise<ActionState & { pickIds?: string[] }> {
  const { household, userId } = await requireHousehold();
  const parsed = idsSchema.safeParse(entryIds);
  if (!parsed.success) return await fail("invalidInput");

  let pickIds: string[];
  try {
    const entries = await prisma.mealPlanEntry.findMany({
      where: {
        id: { in: parsed.data },
        mealPlan: { householdId: household.id },
        consumedAt: null,
        preparedBatchId: null,
      },
      select: { id: true, mealPlanId: true, recipeId: true, freeformName: true, portions: true },
    });
    // A recipe deleted since (the FK is SetNull) leaves nothing to name.
    const movable = entries.filter((e) => e.recipeId || e.freeformName);
    if (movable.length === 0) return await fail("cantUnplaceMeal");
    pickIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const entry of movable) {
        // Guarded on the state just read, so a cook or a batch link that
        // landed in between leaves the meal on its day.
        const removed = await tx.mealPlanEntry.deleteMany({
          where: { id: entry.id, consumedAt: null, preparedBatchId: null },
        });
        if (removed.count === 0) continue;
        const pick = await tx.mealPlanPick.create({
          data: {
            mealPlanId: entry.mealPlanId,
            recipeId: entry.recipeId,
            freeformName: entry.recipeId ? null : entry.freeformName,
            portions: entry.portions,
            createdByUserId: userId,
          },
          select: { id: true },
        });
        ids.push(pick.id);
      }
      return ids;
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  if (pickIds.length === 0) return await fail("cantUnplaceMeal");
  revalidatePath(MEAL_PLANNING_PATH);
  return { pickIds };
}
