"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getPeriodKey } from "@/lib/recurring-template-calc";
import { normalizeStartDay } from "@/lib/budget-date-utils";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { parseShareSplitFormData } from "@/lib/share-split-form";
import { assertNoDuplicateTemplatePeriod, revalidateBudgetPages, type ParsedSplit } from "./action-helpers";
import { invalidateHome } from "@/lib/household-cache";

// --- Recurring templates --------------------------------------------------
// See prisma/schema.prisma's RecurringTemplate/RecurringTemplateAck doc
// comments and src/lib/recurring-template-calc.ts for the "accounted for" model.

const recurringTemplateSchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(120, v("nameTooLong")),
  categoryId: z.string().min(1, v("categoryRequired")),
  amount: z.coerce.number().positive(v("amountPositive")),
  frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]),
  dayOfMonth: z.coerce.number().int().min(1).max(31).optional(),
});

function parseRecurringTemplateFormData(formData: FormData) {
  return recurringTemplateSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    frequency: formData.get("frequency"),
    dayOfMonth: formData.get("dayOfMonth") || undefined,
  });
}

export async function createRecurringTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = parseRecurringTemplateFormData(formData);
  if (!parsed.success) {
    return zodFail(parsed.error);
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return fail("categoryNotFound");

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    "The split amounts must add up to the template's amount",
  );
  if (split && "error" in split) return { error: split.error };

  try {
    await prisma.recurringTemplate.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        name: parsed.data.name,
        amount: parsed.data.amount,
        type: category.type,
        frequency: parsed.data.frequency,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
        splits: split
          ? {
              create: split.map((s) => ({
                householdMemberId: s.householdMemberId,
                amountOwed: s.amountOwed,
              })),
            }
          : undefined,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}

const updateRecurringTemplateSchema = recurringTemplateSchema.extend({
  id: z.string().min(1),
});

export async function updateRecurringTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = updateRecurringTemplateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    frequency: formData.get("frequency"),
    dayOfMonth: formData.get("dayOfMonth") || undefined,
  });
  if (!parsed.success) {
    return zodFail(parsed.error);
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return fail("categoryNotFound");

  const existing = await prisma.recurringTemplate.findFirst({
    where: { id: parsed.data.id, householdId: household.id },
  });
  if (!existing) return fail("recurringItemNotFound");

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    "The split amounts must add up to the template's amount",
  );
  if (split && "error" in split) return { error: split.error };

  // Splits are replaced wholesale (delete-all then recreate) rather than
  // diffed, same convention updateTransactionAction's split handling uses.
  try {
    await prisma.$transaction([
      prisma.recurringTemplateSplit.deleteMany({ where: { recurringTemplateId: existing.id } }),
      prisma.recurringTemplate.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          categoryId: category.id,
          amount: parsed.data.amount,
          type: category.type,
          frequency: parsed.data.frequency,
          dayOfMonth: parsed.data.dayOfMonth ?? null,
          splits: split
            ? {
                create: split.map((s) => ({
                  householdMemberId: s.householdMemberId,
                  amountOwed: s.amountOwed,
                })),
              }
            : undefined,
        },
      }),
    ]);
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}

export async function setRecurringTemplateActiveAction(
  templateId: string,
  active: boolean,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.recurringTemplate.updateMany({
      where: { id: templateId, householdId: household.id },
      data: { active },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}

export async function deleteRecurringTemplateAction(templateId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.recurringTemplate.deleteMany({
      where: { id: templateId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}

/**
 * Checks a template off for the current period without logging a
 * transaction — e.g. a bill paid on autopay from an account this app
 * doesn't track. Idempotent: the unique (templateId, periodKey) constraint
 * means a repeat click just no-ops against the existing row (the upsert's
 * `update: {}` deliberately never overwrites `createdByUserId`, so the
 * original acknowledger stays attributed even if someone else re-clicks it).
 */
export async function acknowledgeTemplatePeriodAction(templateId: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
  });
  if (!template) return fail("recurringItemNotFound");

  const periodKey = getPeriodKey(new Date(), template.frequency, normalizeStartDay(household.budgetMonthStartDay));
  try {
    await prisma.recurringTemplateAck.upsert({
      where: { recurringTemplateId_periodKey: { recurringTemplateId: template.id, periodKey } },
      create: { recurringTemplateId: template.id, periodKey, createdByUserId: userId },
      update: {},
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}

/** A template's shares, with `payerId` having paid the whole `amount` — a
 * payer outside the split gets a 0-share row to carry the payment (see
 * TransactionSplit's doc comment). With no payer, nothing is marked paid. */
function splitsPaidBy(
  shares: { householdMemberId: string; amountOwed: number }[],
  payerId: string | undefined,
  amount: number,
): ParsedSplit[] {
  const splits = shares.map((s) => ({
    householdMemberId: s.householdMemberId,
    amountOwed: s.amountOwed,
    amountPaid: s.householdMemberId === payerId ? amount : 0,
  }));
  if (payerId && !splits.some((s) => s.householdMemberId === payerId)) {
    splits.push({ householdMemberId: payerId, amountOwed: 0, amountPaid: amount });
  }
  return splits;
}

/**
 * One-click "log it as-is" — creates a Transaction straight from the
 * template's own amount/category/frequency (today's date, no dialog, no
 * client-supplied amount/category trusted) for the common case where the
 * amount doesn't need adjusting this period. This produces the same shape
 * of row `createTransactionAction` would when called from
 * `TransactionDialog`'s `prefillFromTemplate` path — including the
 * `recurringTemplateId` link and, when the template has a saved split
 * (RecurringTemplateSplit — see its doc comment in schema.prisma), the same
 * split rows too, so a split bill's split isn't silently dropped just
 * because it was logged with this one-click shortcut instead of through the
 * dialog — so `computeTemplateStatuses` (which derives "posted" purely from
 * a matching transaction's `recurringTemplateId` + period, not from a
 * RecurringTemplateAck row) sees the period as fulfilled without any
 * separate acknowledgement step.
 */
export async function logRecurringTemplateAction(templateId: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
    include: { splits: true },
  });
  if (!template) return fail("recurringItemNotFound");

  const dup = await assertNoDuplicateTemplatePeriod(
    template.id,
    template.frequency,
    new Date(),
    normalizeStartDay(household.budgetMonthStartDay),
  );
  if (dup) return dup;

  // A template has no "paid" concept of its own (see
  // RecurringTemplateSplit's doc comment) — record the whole bill as paid by
  // whoever is clicking "Log as-is", same default TransactionDialog uses for
  // a manually-logged split. Only looked up when the template actually has a
  // split to carry forward; an unsplit template stays unsplit, unaffected.
  const currentMember =
    template.splits.length > 0
      ? await prisma.householdMember.findFirst({
          where: { userId, householdId: household.id },
          select: { id: true },
        })
      : null;

  try {
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        categoryId: template.categoryId,
        amount: template.amount,
        type: template.type,
        description: template.name,
        date: new Date(),
        isRecurring: true,
        recurrenceFrequency: template.frequency,
        createdByUserId: userId,
        recurringTemplateId: template.id,
        splits:
          template.splits.length > 0
            ? { create: splitsPaidBy(template.splits, currentMember?.id, template.amount) }
            : undefined,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidateBudgetPages();
  return {};
}

/** Undoes acknowledgeTemplatePeriodAction for the current period. */
export async function unacknowledgeTemplatePeriodAction(templateId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
  });
  if (!template) return fail("recurringItemNotFound");

  const periodKey = getPeriodKey(new Date(), template.frequency, normalizeStartDay(household.budgetMonthStartDay));
  try {
    await prisma.recurringTemplateAck.deleteMany({
      where: { recurringTemplateId: template.id, periodKey },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidatePath("/dashboard/budget");
  return {};
}
