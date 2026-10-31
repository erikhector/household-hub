"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { MEAL_TYPES } from "@/app/dashboard/meal-planning/meal-types";
import { parseDateKey } from "@/app/dashboard/meal-planning/date-utils";
import { weekKeySchema } from "@/app/dashboard/meal-planning/prepared-batch-calc";
import {
  buildTemplateEntries,
  MAX_TEMPLATE_ENTRIES,
  PLAN_TEMPLATE_NAME_MAX_LENGTH,
  planTemplateRows,
  templateSlotKey,
  type TemplateEntryInput,
} from "@/app/dashboard/meal-planning/plan-template-calc";

// GAP-52: reusable named meal-plan templates, the planner's counterpart to
// the shopping list's templates (GAP-4, shopping-list/template-actions.ts).
// Its own file rather than more weight on planner-actions.ts. Every action is
// household-scoped through requireHousehold() and re-checks that each week,
// template and recipe id it is handed belongs to that household. Applying a
// template returns the same { copied, entryIds } shape as copyWeekAction, so
// the client reuses undoCopyWeekAction for its Undo. See REQUIREMENTS.md,
// "Meal-plan templates".

const MEAL_PLANNING_PATH = "/dashboard/meal-planning";

const templateNameSchema = z.string().trim().min(1).max(PLAN_TEMPLATE_NAME_MAX_LENGTH);

const saveSchema = z.object({ weekStartDate: weekKeySchema, name: templateNameSchema });

export type ApplyTemplateResult = ActionState & { copied?: number; entryIds?: string[] };

async function templateNameTaken(householdId: string, name: string) {
  // Case-insensitive so "School week" and "school week" can't both exist; the
  // DB's @@unique([householdId, name]) is case-sensitive and only a backstop
  // for two concurrent saves.
  const existing = await prisma.mealPlanTemplate.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Form action for the planner menu's "Save week as template" dialog:
 * snapshots the shown week's entries under a new name. Refuses a name already
 * in use instead of overwriting, which would silently throw away the other
 * template.
 */
export async function saveWeekAsTemplateAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning.templates;

  const parsed = saveSchema.safeParse({ weekStartDate: formData.get("weekStartDate"), name: formData.get("name") });
  if (!parsed.success) return { error: dict.errors.invalidName };

  const { name } = parsed.data;
  const weekStart = parseDateKey(parsed.data.weekStartDate);
  try {
    const rows = await prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id, weekStartDate: weekStart } },
      select: { date: true, mealType: true, recipeId: true, freeformName: true, portions: true },
      orderBy: [{ date: "asc" }, { mealType: "asc" }],
    });
    const entries = buildTemplateEntries(weekStart, rows);
    if (entries.length === 0) return { error: dict.errors.emptyWeek };
    if (entries.length > MAX_TEMPLATE_ENTRIES) return { error: dict.errors.tooManyEntries };

    if (await templateNameTaken(household.id, name)) {
      return { error: format(dict.errors.nameTaken, { name }) };
    }

    await prisma.mealPlanTemplate.create({
      data: { householdId: household.id, name, entries: { create: entries } },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: format(dict.errors.nameTaken, { name }) };
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}

/**
 * Stamps a template onto `toWeekStart`. A click action: the picker shows what
 * the template holds and nothing is written until the household presses
 * Apply (suggest, don't mutate). Slots already filled are skipped, never
 * overwritten or stacked onto, and `consumedAt` starts empty. Nothing to
 * write means no MealPlan row either, the rule copyWeekAction follows.
 */
export async function applyMealPlanTemplateAction(
  templateId: string,
  toWeekStart: string,
): Promise<ApplyTemplateResult> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning.templates;

  const week = weekKeySchema.safeParse(toWeekStart);
  if (!week.success) return { error: dict.errors.invalidWeek };

  let created: { id: string }[];
  try {
    const template = await prisma.mealPlanTemplate.findFirst({
      where: { id: templateId, householdId: household.id },
      include: { entries: { orderBy: { dayOffset: "asc" } } },
    });
    if (!template) return { error: dict.errors.notFound };

    const weekStart = parseDateKey(week.data);
    const targetEntries = await prisma.mealPlanEntry.findMany({
      where: { mealPlan: { householdId: household.id, weekStartDate: weekStart } },
      select: { date: true, mealType: true },
    });

    // A recipe id is the one foreign key being stamped out, so it is
    // re-checked against the household rather than trusted.
    const recipeIds = [...new Set(template.entries.flatMap((e) => (e.recipeId ? [e.recipeId] : [])))];
    const ownedRecipeIds = new Set(
      recipeIds.length > 0
        ? (
            await prisma.recipe.findMany({
              where: { id: { in: recipeIds }, householdId: household.id },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [],
    );

    const rows = planTemplateRows(
      weekStart,
      template.entries,
      new Set(targetEntries.map((e) => templateSlotKey(e.date, e.mealType))),
      ownedRecipeIds,
    );
    if (rows.length === 0) return { copied: 0, entryIds: [] };

    const plan = await prisma.mealPlan.upsert({
      where: { householdId_weekStartDate: { householdId: household.id, weekStartDate: weekStart } },
      update: {},
      create: { householdId: household.id, weekStartDate: weekStart },
    });
    created = await prisma.mealPlanEntry.createManyAndReturn({
      data: rows.map((row) => ({ ...row, mealPlanId: plan.id })),
      select: { id: true },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return { copied: created.length, entryIds: created.map((e) => e.id) };
}

export type PlanTemplateSnapshot = { name: string; entries: TemplateEntryInput[] };

/**
 * Deletes a template straight away ("undo over confirm") and hands back what
 * it held so the toast's Undo can put it back with
 * restoreMealPlanTemplateAction.
 */
export async function deleteMealPlanTemplateAction(
  templateId: string,
): Promise<ActionState & { snapshot?: PlanTemplateSnapshot }> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning.templates;

  let snapshot: PlanTemplateSnapshot;
  try {
    const template = await prisma.mealPlanTemplate.findFirst({
      where: { id: templateId, householdId: household.id },
      include: { entries: { orderBy: { dayOffset: "asc" } } },
    });
    if (!template) return { error: dict.errors.notFound };

    await prisma.mealPlanTemplate.deleteMany({ where: { id: template.id, householdId: household.id } });
    snapshot = {
      name: template.name,
      entries: template.entries.map(({ dayOffset, mealType, recipeId, freeformName, portions }) => ({
        dayOffset,
        mealType,
        recipeId,
        freeformName,
        portions,
      })),
    };
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return { snapshot };
}

const snapshotSchema = z.object({
  name: templateNameSchema,
  entries: z
    .array(
      z.object({
        dayOffset: z.number().int().min(0).max(6),
        mealType: z.enum(MEAL_TYPES),
        recipeId: z.string().min(1).nullable(),
        freeformName: z.string().trim().min(1).max(120).nullable(),
        portions: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(MAX_TEMPLATE_ENTRIES),
});

/**
 * The Undo for deleteMealPlanTemplateAction. The snapshot comes back from the
 * client, so it is validated like any other input and every recipe id in it
 * is re-checked against the caller's household: an entry whose recipe is not
 * theirs (or was deleted meanwhile) is dropped rather than trusted.
 */
export async function restoreMealPlanTemplateAction(snapshot: PlanTemplateSnapshot): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning.templates;

  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) return { error: dict.errors.invalidName };

  const { name, entries } = parsed.data;
  try {
    if (await templateNameTaken(household.id, name)) {
      return { error: format(dict.errors.nameTaken, { name }) };
    }
    const recipeIds = [...new Set(entries.flatMap((e) => (e.recipeId ? [e.recipeId] : [])))];
    const owned = new Set(
      recipeIds.length > 0
        ? (
            await prisma.recipe.findMany({
              where: { id: { in: recipeIds }, householdId: household.id },
              select: { id: true },
            })
          ).map((r) => r.id)
        : [],
    );
    const kept = entries
      .filter((e) => (e.recipeId ? owned.has(e.recipeId) : e.freeformName !== null))
      .map((e) => ({ ...e, freeformName: e.recipeId ? null : e.freeformName }));
    if (kept.length === 0) return { error: dict.errors.emptyWeek };

    await prisma.mealPlanTemplate.create({
      data: { householdId: household.id, name, entries: { create: kept } },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: format(dict.errors.nameTaken, { name }) };
    return toFriendlyError(error);
  }

  revalidatePath(MEAL_PLANNING_PATH);
  return {};
}
