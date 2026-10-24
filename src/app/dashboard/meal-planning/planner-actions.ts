"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { MEAL_TYPES, CUSTOM_RECIPE_SENTINEL } from "@/app/dashboard/meal-planning/meal-types";
import { addDays, getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { LEFTOVERS_DAY_SEARCH_DAYS, nextFreeDinnerDay } from "@/app/dashboard/meal-planning/leftovers";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import {
  assignInTx,
  BatchChangedError,
  PrepAssignError,
  returnEntryPortionsInTx,
} from "@/app/dashboard/meal-planning/prep-assign";
import { weekKeySchema } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import { clearCookSoon } from "@/app/dashboard/meal-planning/cook-soon";

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

const addEntrySchema = z.object({
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidWeek")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDate")),
  mealType: z.enum(MEAL_TYPES),
  recipeId: z.string().optional(),
  freeformName: z.string().trim().max(120).optional(),
  // How many portions of the recipe this slot is for — see
  // MealPlanEntry.portions' doc comment in schema.prisma. Optional because a
  // freeform entry has no recipe to scale; when omitted for a recipe entry,
  // addMealEntryAction below falls back to that recipe's own `servings` (i.e.
  // "one full recipe"), matching pre-portions behavior.
  portions: z.coerce.number().int().min(1, v("portionsMin")).max(1_000).optional(),
  // GAP-49: eat this slot from a prepared batch. The batch decides the dish,
  // so recipeId/freeformName are ignored when it's sent.
  preparedBatchId: z.string().min(1).optional(),
});

export async function addMealEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = addEntrySchema.safeParse({
    weekStartDate: formData.get("weekStartDate"),
    date: formData.get("date"),
    mealType: formData.get("mealType"),
    recipeId: formData.get("recipeId") || undefined,
    freeformName: formData.get("freeformName") || undefined,
    portions: formData.get("portions") || undefined,
    preparedBatchId: formData.get("preparedBatchId") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const { weekStartDate, date, mealType, recipeId, freeformName, preparedBatchId } = parsed.data;

  if (preparedBatchId) {
    const batch = await prisma.preparedBatch.findFirst({
      where: { id: preparedBatchId, householdId: household.id },
      select: { id: true, recipeId: true },
    });
    if (!batch) return await fail("prepBatchNotFound");
    // assignInTx derives the week from the date itself, so the client's
    // weekStartDate isn't needed here. One portion unless the form says
    // otherwise: a batch slot is one person's meal, not "one full recipe".
    try {
      await prisma.$transaction((tx) =>
        assignInTx(tx, household.id, batch, [{ date, mealType, portions: parsed.data.portions ?? 1 }]),
      );
    } catch (error) {
      if (error instanceof PrepAssignError) return await fail(error.key);
      return toFriendlyError(error);
    }
    revalidatePath(MEAL_PLANNING_PATH);
    revalidatePath("/dashboard");
    return {};
  }

  let linkedRecipeId: string | null = null;
  let freeformMealName: string | null = null;
  // Falls back to the recipe's own serving size (i.e. "one full recipe")
  // when the form doesn't send an explicit portions count.
  let portions = parsed.data.portions ?? 4;

  if (recipeId && recipeId !== CUSTOM_RECIPE_SENTINEL) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, householdId: household.id },
    });
    if (!recipe) return await fail("recipeNotFound");
    linkedRecipeId = recipe.id;
    portions = parsed.data.portions ?? recipe.servings;
  } else {
    if (!freeformName) return await fail("chooseRecipeOrMeal");
    freeformMealName = freeformName;
  }

  const plan = await prisma.mealPlan.upsert({
    where: {
      householdId_weekStartDate: {
        householdId: household.id,
        weekStartDate: new Date(`${weekStartDate}T00:00:00.000Z`),
      },
    },
    update: {},
    create: {
      householdId: household.id,
      weekStartDate: new Date(`${weekStartDate}T00:00:00.000Z`),
    },
  });

  await prisma.mealPlanEntry.create({
    data: {
      mealPlanId: plan.id,
      date: new Date(`${date}T00:00:00.000Z`),
      mealType,
      recipeId: linkedRecipeId,
      freeformName: freeformMealName,
      portions,
    },
  });
  // GAP-51: a recipe with a day no longer belongs on the Cook soon shelf.
  await clearCookSoon(prisma, household.id, linkedRecipeId);

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

const updateEntrySchema = z.object({
  entryId: z.string().min(1),
  recipeId: z.string().optional(),
  freeformName: z.string().trim().max(120).optional(),
  portions: z.coerce.number().int().min(1, v("portionsMin")).max(1_000).optional(),
});

export async function updateMealEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = updateEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    recipeId: formData.get("recipeId") || undefined,
    freeformName: formData.get("freeformName") || undefined,
    portions: formData.get("portions") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const { entryId, recipeId, freeformName } = parsed.data;

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
  });
  if (!entry) return await fail("mealNotFound");

  let linkedRecipeId: string | null = null;
  let freeformMealName: string | null = null;
  let portions = parsed.data.portions ?? 4;

  if (recipeId && recipeId !== CUSTOM_RECIPE_SENTINEL) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, householdId: household.id },
    });
    if (!recipe) return await fail("recipeNotFound");
    linkedRecipeId = recipe.id;
    portions = parsed.data.portions ?? recipe.servings;
  } else {
    if (!freeformName) return await fail("chooseRecipeOrMeal");
    freeformMealName = freeformName;
  }

  const edit = {
    where: { id: entry.id },
    data: { recipeId: linkedRecipeId, freeformName: freeformMealName, portions },
  };

  // GAP-49: an entry eating from a batch eats that batch's dish, its
  // portions taken out of it. A new dish or portion count breaks both, so
  // the entry is unlinked first, in the same transaction as the edit: its
  // portions go back to the batch and it cooks fresh, as "Unplan" does. A
  // cooked entry ate its portions, so it's unlinked without returning them.
  const unlink =
    !!entry.preparedBatchId && (linkedRecipeId !== entry.recipeId || portions !== entry.portions);
  if (!unlink) {
    await prisma.mealPlanEntry.update(edit);
    await clearCookSoon(prisma, household.id, linkedRecipeId);
    revalidatePath(MEAL_PLANNING_PATH);
    return {};
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Guarded on the values just read, like unassignBatchPortionAction,
      // so a concurrent unplan, delete or cook can't make this return the
      // portions a second time (or return eaten ones).
      const reset = await tx.mealPlanEntry.updateMany({
        where: {
          id: entry.id,
          preparedBatchId: entry.preparedBatchId,
          preparedPortionsUsed: entry.preparedPortionsUsed,
          consumedAt: entry.consumedAt ? { not: null } : null,
        },
        data: { preparedBatchId: null, preparedPortionsUsed: 0 },
      });
      if (reset.count === 0) throw new BatchChangedError();
      if (!entry.consumedAt) await returnEntryPortionsInTx(tx, household.id, entry);
      await tx.mealPlanEntry.update(edit);
      await clearCookSoon(tx, household.id, linkedRecipeId);
    });
  } catch (error) {
    if (error instanceof BatchChangedError) return await fail("generic");
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}

// A real calendar date, not just the `yyyy-mm-dd` shape: "2026-02-31" would
// otherwise roll over to March 3rd inside `new Date()` and silently land the
// meal somewhere the user never picked.
const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDate"))
  .refine((key) => {
    const date = parseDateKey(key);
    return !Number.isNaN(date.getTime()) && toDateKey(date) === key;
  }, v("invalidDate"));

const moveEntrySchema = z.object({
  entryId: z.string().min(1),
  date: dateKeySchema,
  mealType: z.enum(MEAL_TYPES),
});

// GAP-30: move a planned meal to another day and/or meal type, instead of
// deleting it and adding it again (which loses its portions and forces
// re-picking the recipe). A sibling of updateMealEntryAction rather than an
// extension of it, so the edit form's "what's cooked" fields and this
// "when" form stay independent and neither can clobber the other's columns.
//
// Unlike addMealEntryAction, the client doesn't send a week key at all: the
// target week is derived here from the picked date via getWeekStart, so a
// crafted form can't file an entry under a MealPlan whose week doesn't
// contain its date (a row no page view would ever show). A date in another
// week find-or-creates that week's MealPlan the same way add does. Slots
// stack exactly as they do for add: moving into a slot that already has a
// meal just puts both there, since there's no uniqueness constraint on
// (date, mealType).
//
// A cooked entry can't be moved. Its date and slot are the record of when
// that meal was actually eaten and its ingredients came out of inventory, so
// moving it would rewrite history rather than change a plan. It's the same
// reason the edit pencil is hidden once a meal is cooked, and like editing,
// a cooked meal is final once "Mark as cooked"'s short Undo toast is gone.
export async function moveMealEntryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = moveEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    date: formData.get("date"),
    mealType: formData.get("mealType"),
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const { entryId, date, mealType } = parsed.data;

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true, consumedAt: true },
  });
  if (!entry) return await fail("mealNotFound");
  if (entry.consumedAt) return await fail("cookedMealCantMove");

  const targetDate = parseDateKey(date);
  const weekStartDate = getWeekStart(targetDate);

  // The source week's MealPlan row is left behind even if this empties it,
  // the same as deleting its last entry would: an empty plan is harmless and
  // the page already treats "no row" and "no entries" alike.
  const plan = await prisma.mealPlan.upsert({
    where: { householdId_weekStartDate: { householdId: household.id, weekStartDate } },
    update: {},
    create: { householdId: household.id, weekStartDate },
  });

  // Moving a meal is the household answering a "Meal not logged" reminder
  // ("we didn't cook it, it's on Thursday now"), so an open one for this
  // entry is dismissed alongside the move rather than left in the bell
  // pointing at the new date. It's dismissed, not deleted: that reminder
  // fires at most once per entry, ever (see "Meal not logged" in
  // REQUIREMENTS.md), and a moved meal doesn't get a second nag.
  await prisma.$transaction([
    prisma.mealPlanEntry.update({
      where: { id: entry.id },
      data: { mealPlanId: plan.id, date: targetDate, mealType },
    }),
    prisma.notification.updateMany({
      where: {
        householdId: household.id,
        mealPlanEntryId: entry.id,
        kind: "MEAL_NOT_LOGGED",
        dismissedAt: null,
      },
      data: { dismissedAt: new Date() },
    }),
  ]);

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

export async function deleteMealEntryAction(entryId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const entry = await prisma.mealPlanEntry.findFirst({
    where: { id: entryId, mealPlan: { householdId: household.id } },
    select: { id: true, preparedBatchId: true, preparedPortionsUsed: true, consumedAt: true },
  });
  if (!entry) return {};

  // GAP-49: an uneaten meal planned from a batch gives its portions back,
  // in the same transaction as the delete. An eaten one keeps them eaten,
  // and one whose batch went with its recipe (SetNull, a stale count left
  // behind) has nothing to give back to: both just delete.
  if (!entry.preparedBatchId || entry.consumedAt) {
    await prisma.mealPlanEntry.delete({ where: { id: entry.id } });
    revalidatePath(MEAL_PLANNING_PATH);
    return {};
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Guarded on the values just read, so a double-clicked delete (or one
      // racing an unplan or a cook) returns the portions at most once.
      const deleted = await tx.mealPlanEntry.deleteMany({
        where: {
          id: entry.id,
          preparedBatchId: entry.preparedBatchId,
          preparedPortionsUsed: entry.preparedPortionsUsed,
          consumedAt: null,
        },
      });
      if (deleted.count === 0) return;
      await returnEntryPortionsInTx(tx, household.id, entry);
    });
  } catch (error) {
    // The batch moved under us and everything rolled back, so the meal is
    // still planned. The confirm dialog toasts the error, so the household
    // knows to try again rather than wondering why the meal is still there;
    // re-throwing would hit the error boundary instead.
    if (error instanceof BatchChangedError) return await fail("generic");
    throw error;
  }

  revalidatePath(MEAL_PLANNING_PATH);
  revalidatePath("/dashboard");
  return {};
}

const copyWeekSchema = z
  .object({ fromWeekStart: weekKeySchema, toWeekStart: weekKeySchema })
  .refine((v) => v.fromWeekStart !== v.toWeekStart, v("chooseDifferentWeek"));

export type CopyWeekResult = ActionState & {
  // How many entries were actually written (skipped slots excluded), and
  // their ids so the client's Undo toast can take exactly those back off
  // again via undoCopyWeekAction, never anything that was already there.
  copied?: number;
  entryIds?: string[];
};

// GAP-23: repeat a week's plan onto another week instead of re-picking every
// recipe. It's a click action (called from a useTransition, not a form), so
// both week keys arrive as plain arguments and are re-validated here rather
// than trusted.
//
// Each source entry keeps its weekday offset (Tuesday stays Tuesday), meal
// type, recipe or freeform name, and portions. `consumedAt` is deliberately
// *not* carried over: last week's "cooked" state says nothing about this
// week's. A target slot (date + mealType) that already has anything in it is
// left alone rather than overwritten or stacked onto, so re-running the copy
// after partly filling a week just fills the gaps.
export async function copyWeekAction(fromWeekStart: string, toWeekStart: string): Promise<CopyWeekResult> {
  const { household } = await requireHousehold();

  const parsed = copyWeekSchema.safeParse({ fromWeekStart, toWeekStart });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const fromDate = parseDateKey(parsed.data.fromWeekStart);
  const toDate = parseDateKey(parsed.data.toWeekStart);

  const [sourceEntries, targetEntries] = await Promise.all([
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id, weekStartDate: fromDate } },
      select: { date: true, mealType: true, recipeId: true, freeformName: true, portions: true },
      orderBy: [{ date: "asc" }, { mealType: "asc" }],
    }),
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id, weekStartDate: toDate } },
      select: { date: true, mealType: true },
    }),
  ]);

  // The source entries are already scoped to this household's own plan, so
  // their recipes *should* be too. A recipe id is the one foreign key being
  // copied, though, so it's re-checked against the household in one query
  // rather than trusted, the same guard addMealEntryAction applies.
  const sourceRecipeIds = [
    ...new Set(sourceEntries.map((e) => e.recipeId).filter((id): id is string => id !== null)),
  ];
  const ownedRecipeIds = new Set(
    sourceRecipeIds.length > 0
      ? (
          await prisma.recipe.findMany({
            where: { id: { in: sourceRecipeIds }, householdId: household.id },
            select: { id: true },
          })
        ).map((r) => r.id)
      : [],
  );

  const slotKey = (date: Date, mealType: string) => `${toDateKey(date)}|${mealType}`;
  const filledSlots = new Set(targetEntries.map((e) => slotKey(e.date, e.mealType)));
  const dayOffset = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);

  const rows = sourceEntries.flatMap((entry) => {
    const date = addDays(entry.date, dayOffset);
    if (filledSlots.has(slotKey(date, entry.mealType))) return [];
    const recipeId = entry.recipeId && ownedRecipeIds.has(entry.recipeId) ? entry.recipeId : null;
    // A recipe that's since been deleted (the FK is SetNull) or that failed
    // the ownership check leaves nothing to show for the slot, so skip it
    // rather than writing a nameless entry.
    if (!recipeId && !entry.freeformName) return [];
    return [
      {
        date,
        mealType: entry.mealType,
        recipeId,
        freeformName: recipeId ? null : entry.freeformName,
        portions: entry.portions,
      },
    ];
  });

  // Nothing to write means no MealPlan row either, the same "don't create a
  // plan on a no-op" rule page views follow (see the weekly planner section
  // in REQUIREMENTS.md).
  if (rows.length === 0) return { copied: 0, entryIds: [] };

  const plan = await prisma.mealPlan.upsert({
    where: { householdId_weekStartDate: { householdId: household.id, weekStartDate: toDate } },
    update: {},
    create: { householdId: household.id, weekStartDate: toDate },
  });

  const created = await prisma.mealPlanEntry.createManyAndReturn({
    data: rows.map((row) => ({ ...row, mealPlanId: plan.id })),
    select: { id: true },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return { copied: created.length, entryIds: created.map((e) => e.id) };
}

const fillEmptyDaysSchema = z.object({
  weekStartDate: weekKeySchema,
  // One pick per day, so at most seven; the dates and recipes must each be
  // unique, which is the "no repeat within the week" rule the preview shows.
  picks: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDate")), recipeId: z.string().min(1) }))
    .min(1)
    .max(7),
});

// GAP-45: writes the dinners a household accepted in the "Fill empty days"
// preview. The proposal itself is computed client-side from data the page
// already has and writes nothing, so this is the only write. It's a click
// action; the week and picks are re-validated here, never trusted.
//
// Everything is re-checked against the database because the preview can be
// stale: recipes must belong to the household (one findMany), each date must
// fall inside the named week, and a day that has gained any entry since the
// preview opened is skipped, never stacked onto. Rows carry the recipe's own
// `servings` as portions, like addMealEntryAction's default. The result
// shape matches copyWeekAction's so the client reuses undoCopyWeekAction.
export async function fillEmptyDaysAction(
  weekStartDate: string,
  picks: { date: string; recipeId: string }[],
): Promise<CopyWeekResult> {
  const { household } = await requireHousehold();

  const parsed = fillEmptyDaysSchema.safeParse({ weekStartDate, picks });
  if (!parsed.success) return await zodFail(parsed.error);

  const weekStart = parseDateKey(parsed.data.weekStartDate);
  const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => toDateKey(addDays(weekStart, i))));
  const dates = parsed.data.picks.map((p) => p.date);
  const recipeIds = parsed.data.picks.map((p) => p.recipeId);
  if (
    dates.some((d) => !weekKeys.has(d)) ||
    new Set(dates).size !== dates.length ||
    new Set(recipeIds).size !== recipeIds.length
  ) {
    return await fail("invalidInput");
  }

  const [recipes, existing] = await Promise.all([
    prisma.recipe.findMany({
      where: { id: { in: recipeIds }, householdId: household.id },
      select: { id: true, servings: true },
    }),
    prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id, weekStartDate: weekStart } },
      select: { date: true },
    }),
  ]);
  const servingsById = new Map(recipes.map((r) => [r.id, r.servings]));
  if (servingsById.size !== recipeIds.length) return await fail("recipeNotFound");

  const busyDays = new Set(existing.map((e) => toDateKey(e.date)));
  const rows = parsed.data.picks
    .filter((p) => !busyDays.has(p.date))
    .map((p) => ({
      date: parseDateKey(p.date),
      mealType: "DINNER" as const,
      recipeId: p.recipeId,
      freeformName: null,
      portions: servingsById.get(p.recipeId)!,
    }));
  if (rows.length === 0) return { copied: 0, entryIds: [] };

  const plan = await prisma.mealPlan.upsert({
    where: { householdId_weekStartDate: { householdId: household.id, weekStartDate: weekStart } },
    update: {},
    create: { householdId: household.id, weekStartDate: weekStart },
  });
  const created = await prisma.mealPlanEntry.createManyAndReturn({
    data: rows.map((row) => ({ ...row, mealPlanId: plan.id })),
    select: { id: true },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return { copied: created.length, entryIds: created.map((e) => e.id) };
}

// The cap is well above anything a real week produces (7 days x 4 meal
// types, with room for stacked entries). It only stops a crafted call from
// sending an unbounded id list.
const undoCopyWeekSchema = z.array(z.string().min(1)).min(1).max(500);

// The Undo on copyWeekAction's toast. It only deletes entries that belong to
// this household and haven't been marked cooked or linked to a prepared batch
// since. Cooking one of the copied meals while the toast is still up means
// it's real now, and deleting it would silently drop the record of that
// inventory decrement. Linking one (GAP-49) is the same: the entry holds the
// batch's portions, and deleting it would lose them, since only an unlink
// hands portions back.
export async function undoCopyWeekAction(entryIds: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = undoCopyWeekSchema.safeParse(entryIds);
  if (!parsed.success) return await fail("invalidInput");

  await prisma.mealPlanEntry.deleteMany({
    where: {
      id: { in: parsed.data },
      consumedAt: null,
      preparedBatchId: null,
      mealPlan: { householdId: household.id },
    },
  });

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

// GAP-39: the day "Plan leftovers" prefills — the first day after `afterDate`
// with no dinner planned. Read-only: it only looks, and the add-to-plan
// dialog the date lands in writes nothing until the household confirms. The
// household comes from the session; the client only names the date to
// search after.
export async function suggestLeftoversDayAction(
  afterDate: string,
): Promise<{ date: string } | { error: string }> {
  const { household } = await requireHousehold();
  if (!isDateKey(afterDate) || Number.isNaN(parseDateKey(afterDate).getTime())) {
    return await fail("invalidDate");
  }

  const start = parseDateKey(afterDate);
  const dinners = await prisma.mealPlanEntry.findMany({
    where: {
      mealPlan: { householdId: household.id },
      mealType: "DINNER",
      date: { gt: start, lte: addDays(start, LEFTOVERS_DAY_SEARCH_DAYS) },
    },
    select: { date: true },
  });
  return { date: nextFreeDinnerDay(afterDate, dinners.map((d) => toDateKey(d.date))) };
}
