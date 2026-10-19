"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getPeriodBounds, getPeriodKey, type TemplateFrequency } from "@/lib/recurring-template-calc";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { isPlannedExpenseTarget, isUniqueViolation } from "@/lib/prisma-errors";
import {
  limitForType,
  monthlyLimitField,
  rolloverEnabledField,
  rolloverForLimit,
} from "@/lib/budget-category-limit";
import { goalAmountField, goalDateField, goalForType } from "@/lib/savings-goal-calc";

// --- Categories --------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  type: z.enum(["INCOME", "EXPENSE", "SAVINGS"]),
  // GAP-12 — see src/lib/budget-category-limit.ts. Empty = no limit.
  monthlyLimit: monthlyLimitField,
  // GAP-21 — see src/lib/budget-rollover-calc.ts. Kept only with a limit.
  rolloverEnabled: rolloverEnabledField,
  // GAP-22 — see src/lib/savings-goal-calc.ts. Kept only on SAVINGS.
  goalAmount: goalAmountField,
  goalDate: goalDateField,
});

export async function createPersonalCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    monthlyLimit: formData.get("monthlyLimit"),
    rolloverEnabled: formData.get("rolloverEnabled"),
    goalAmount: formData.get("goalAmount"),
    goalDate: formData.get("goalDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await prisma.personalBudgetCategory.findFirst({
    where: { userId, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return { error: "A category with that name already exists" };

  const monthlyLimit = limitForType(parsed.data.type, parsed.data.monthlyLimit);
  const goal = goalForType(parsed.data.type, parsed.data.goalAmount, parsed.data.goalDate);
  try {
    await prisma.personalBudgetCategory.create({
      data: {
        userId,
        name: parsed.data.name,
        type: parsed.data.type,
        monthlyLimit,
        rolloverEnabled: rolloverForLimit(monthlyLimit, parsed.data.rolloverEnabled),
        ...goal,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  // A category's type can't be edited, so whether this is kept is decided
  // by the stored type below, not by anything the form sends.
  monthlyLimit: monthlyLimitField,
  rolloverEnabled: rolloverEnabledField,
  // GAP-22 — see src/lib/savings-goal-calc.ts. Kept only on SAVINGS.
  goalAmount: goalAmountField,
  goalDate: goalDateField,
});

export async function updatePersonalCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = updateCategorySchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    monthlyLimit: formData.get("monthlyLimit"),
    rolloverEnabled: formData.get("rolloverEnabled"),
    goalAmount: formData.get("goalAmount"),
    goalDate: formData.get("goalDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.id, userId },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.personalBudgetCategory.findFirst({
    where: {
      userId,
      name: { equals: parsed.data.name, mode: "insensitive" },
      NOT: { id: category.id },
    },
  });
  if (existing) return { error: "A category with that name already exists" };

  const monthlyLimit = limitForType(category.type, parsed.data.monthlyLimit);
  // Decided from the stored type like the limit above: a category's type
  // can't be edited, so an income/expense category can never gain a goal
  // (or keep a stale one) whatever the form sends.
  const goal = goalForType(category.type, parsed.data.goalAmount, parsed.data.goalDate);
  try {
    await prisma.personalBudgetCategory.update({
      where: { id: category.id },
      data: {
        name: parsed.data.name,
        monthlyLimit,
        rolloverEnabled: rolloverForLimit(monthlyLimit, parsed.data.rolloverEnabled),
        ...goal,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function deletePersonalCategoryAction(categoryId: string): Promise<ActionState> {
  const userId = await requireUserId();

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: categoryId, userId },
    include: {
      _count: { select: { transactions: true } },
      // See budget/actions.ts's deleteCategoryAction for why this is
      // checked explicitly rather than just letting the FK restrict fail.
      recurringTemplates: { select: { name: true }, orderBy: { active: "desc" }, take: 1 },
      // Same for planned bills (PersonalPlannedExpense's category is Restrict).
      plannedExpenses: { select: { name: true }, take: 1 },
    },
  });
  if (!category) return { error: "Category not found" };
  if (category._count.transactions > 0) {
    return { error: "This category has transactions and can't be deleted" };
  }
  const blockingTemplate = category.recurringTemplates[0];
  if (blockingTemplate) {
    return {
      error: `This category is used by the recurring item "${blockingTemplate.name}" — remove or reassign it first`,
    };
  }
  const blockingPlanned = category.plannedExpenses[0];
  if (blockingPlanned) return fail("categoryUsedByPlannedBill", { name: blockingPlanned.name });

  try {
    await prisma.personalBudgetCategory.delete({ where: { id: category.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

// --- Transactions --------------------------------------------------------

const transactionSchema = z.object({
  categoryId: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  description: z.string().trim().max(200).optional(),
  date: z.string().min(1, "Date is required"),
  isRecurring: z.boolean(),
  recurrenceFrequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  // Mirrors the household budget's recurringTemplateId — see
  // src/app/dashboard/budget/actions.ts's transactionSchema doc comment.
  recurringTemplateId: z.string().optional(),
  // Set when logging a payment against a personal planned bill. Only read
  // on create, like the household's (src/app/dashboard/budget/actions.ts).
  plannedExpenseId: z.string().optional(),
});

function parseTransactionFormData(formData: FormData) {
  return transactionSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
    date: formData.get("date"),
    isRecurring: formData.get("isRecurring") === "on",
    recurrenceFrequency: formData.get("recurrenceFrequency") || undefined,
    recurringTemplateId: formData.get("recurringTemplateId") || undefined,
    plannedExpenseId: formData.get("plannedExpenseId") || undefined,
  });
}

/** Validates an optional client-supplied plannedExpenseId belongs to the
 * caller and isn't already paid (a planned bill has at most one payment) —
 * the personal mirror of budget/actions.ts's resolvePlannedExpenseId. */
async function resolvePersonalPlannedExpenseId(
  userId: string,
  plannedExpenseId: string | undefined,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!plannedExpenseId) return { id: undefined };
  const planned = await prisma.personalPlannedExpense.findFirst({
    where: { id: plannedExpenseId, userId },
    select: { id: true, transaction: { select: { id: true } } },
  });
  if (!planned) return fail("plannedBillNotFound");
  if (planned.transaction) return fail("plannedBillAlreadyPaid");
  return { id: planned.id };
}

async function resolvePersonalRecurringTemplateId(
  userId: string,
  recurringTemplateId: string | undefined,
): Promise<{ error: string } | { id: undefined } | { id: string; frequency: TemplateFrequency }> {
  if (!recurringTemplateId) return { id: undefined };
  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: recurringTemplateId, userId },
    select: { id: true, frequency: true },
  });
  if (!template) return { error: "Recurring template not found" };
  return { id: template.id, frequency: template.frequency };
}

/** Mirrors budget/actions.ts's assertNoDuplicateTemplatePeriod for
 * PersonalTransaction/PersonalRecurringTemplate — see its doc comment. Only
 * two entry points here (personal budget has no "Log payment" equivalent),
 * but the same race is possible between them. */
async function assertNoDuplicatePersonalTemplatePeriod(
  recurringTemplateId: string,
  frequency: TemplateFrequency,
  date: Date,
): Promise<{ error: string } | null> {
  const periodKey = getPeriodKey(date, frequency);
  // Bounded to the period's date range — see budget/actions.ts (PERF-17).
  const { start, end } = getPeriodBounds(date, frequency);
  const existing = await prisma.personalTransaction.findMany({
    where: { recurringTemplateId, date: { gte: start, lt: end } },
    select: { date: true },
  });
  const alreadyLogged = existing.some((t) => getPeriodKey(t.date, frequency) === periodKey);
  return alreadyLogged
    ? { error: "A transaction for this recurring item already exists for this period" }
    : null;
}

export async function createPersonalTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = parseTransactionFormData(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.isRecurring && !parsed.data.recurrenceFrequency) {
    return { error: "Choose how often this repeats" };
  }

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.categoryId, userId },
  });
  if (!category) return { error: "Category not found" };

  const recurringTemplate = await resolvePersonalRecurringTemplateId(
    userId,
    parsed.data.recurringTemplateId,
  );
  if ("error" in recurringTemplate) return { error: recurringTemplate.error };
  if (recurringTemplate.id) {
    const dup = await assertNoDuplicatePersonalTemplatePeriod(
      recurringTemplate.id,
      recurringTemplate.frequency,
      new Date(parsed.data.date),
    );
    if (dup) return dup;
  }

  // A planned bill is an expense by definition (its own category must be
  // one), so its payment must be too, or it would stop counting as spent.
  if (parsed.data.plannedExpenseId && category.type !== "EXPENSE") {
    return fail("plannedBillNeedsExpenseCategory");
  }
  const planned = await resolvePersonalPlannedExpenseId(userId, parsed.data.plannedExpenseId);
  if ("error" in planned) return { error: planned.error };

  let created;
  try {
    created = await prisma.personalTransaction.create({
      data: {
        userId,
        categoryId: category.id,
        amount: parsed.data.amount,
        // Derived from the category rather than taken as a separate field, so
        // a transaction can never disagree with its own category's type.
        type: category.type,
        description: parsed.data.description || null,
        date: new Date(parsed.data.date),
        isRecurring: parsed.data.isRecurring,
        recurrenceFrequency: parsed.data.isRecurring ? parsed.data.recurrenceFrequency : null,
        recurringTemplateId: recurringTemplate.id ?? null,
        plannedExpenseId: planned.id ?? null,
      },
      select: { id: true },
    });
  } catch (error) {
    // Two payments for the same bill racing past the check above: the
    // unique index on plannedExpenseId rejects the loser.
    if (isUniqueViolation(error) && isPlannedExpenseTarget(error)) {
      return fail("plannedBillAlreadyPaid");
    }
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return { createdId: created.id };
}

const updateTransactionSchema = transactionSchema.extend({
  id: z.string().min(1),
});

export async function updatePersonalTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = updateTransactionSchema.safeParse({
    id: formData.get("id"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
    date: formData.get("date"),
    isRecurring: formData.get("isRecurring") === "on",
    recurrenceFrequency: formData.get("recurrenceFrequency") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.isRecurring && !parsed.data.recurrenceFrequency) {
    return { error: "Choose how often this repeats" };
  }

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.categoryId, userId },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.personalTransaction.findFirst({
    where: { id: parsed.data.id, userId },
    select: { id: true, plannedExpenseId: true },
  });
  if (!existing) return { error: "Transaction not found" };
  // Same rule as on create: a planned bill's payment stays an expense.
  if (existing.plannedExpenseId && category.type !== "EXPENSE") {
    return fail("plannedBillNeedsExpenseCategory");
  }

  try {
    await prisma.personalTransaction.update({
      where: { id: existing.id },
      data: {
        categoryId: category.id,
        amount: parsed.data.amount,
        type: category.type,
        description: parsed.data.description || null,
        date: new Date(parsed.data.date),
        isRecurring: parsed.data.isRecurring,
        recurrenceFrequency: parsed.data.isRecurring ? parsed.data.recurrenceFrequency : null,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function deletePersonalTransactionAction(transactionId: string): Promise<ActionState> {
  const userId = await requireUserId();

  try {
    await prisma.personalTransaction.deleteMany({
      where: { id: transactionId, userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

// --- Recurring templates --------------------------------------------------
// Mirrors src/app/dashboard/budget/actions.ts's recurring-template actions
// for PersonalRecurringTemplate/PersonalRecurringTemplateAck — see
// prisma/schema.prisma's doc comments for the "accounted for" model.

const recurringTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  categoryId: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
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

export async function createPersonalRecurringTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = parseRecurringTemplateFormData(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.categoryId, userId },
  });
  if (!category) return { error: "Category not found" };

  try {
    await prisma.personalRecurringTemplate.create({
      data: {
        userId,
        categoryId: category.id,
        name: parsed.data.name,
        amount: parsed.data.amount,
        type: category.type,
        frequency: parsed.data.frequency,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

const updatePersonalRecurringTemplateSchema = recurringTemplateSchema.extend({
  id: z.string().min(1),
});

export async function updatePersonalRecurringTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = updatePersonalRecurringTemplateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    frequency: formData.get("frequency"),
    dayOfMonth: formData.get("dayOfMonth") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.categoryId, userId },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.personalRecurringTemplate.findFirst({
    where: { id: parsed.data.id, userId },
  });
  if (!existing) return { error: "Recurring template not found" };

  try {
    await prisma.personalRecurringTemplate.update({
      where: { id: existing.id },
      data: {
        name: parsed.data.name,
        categoryId: category.id,
        amount: parsed.data.amount,
        type: category.type,
        frequency: parsed.data.frequency,
        dayOfMonth: parsed.data.dayOfMonth ?? null,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function setPersonalRecurringTemplateActiveAction(
  templateId: string,
  active: boolean,
): Promise<ActionState> {
  const userId = await requireUserId();

  try {
    await prisma.personalRecurringTemplate.updateMany({
      where: { id: templateId, userId },
      data: { active },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function deletePersonalRecurringTemplateAction(
  templateId: string,
): Promise<ActionState> {
  const userId = await requireUserId();

  try {
    await prisma.personalRecurringTemplate.deleteMany({
      where: { id: templateId, userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

/**
 * One-click "log it as-is" — mirrors logRecurringTemplateAction in
 * src/app/dashboard/budget/actions.ts for PersonalTransaction/
 * PersonalRecurringTemplate. Creates a PersonalTransaction straight from the
 * template's own amount/category/frequency (today's date, no dialog), which
 * is already sufficient for computeTemplateStatuses to see this period as
 * "posted" — no separate acknowledgement row needed.
 */
export async function logPersonalRecurringTemplateAction(templateId: string): Promise<ActionState> {
  const userId = await requireUserId();

  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: templateId, userId },
  });
  if (!template) return { error: "Recurring template not found" };

  const dup = await assertNoDuplicatePersonalTemplatePeriod(template.id, template.frequency, new Date());
  if (dup) return dup;

  try {
    await prisma.personalTransaction.create({
      data: {
        userId,
        categoryId: template.categoryId,
        amount: template.amount,
        type: template.type,
        description: template.name,
        date: new Date(),
        isRecurring: true,
        recurrenceFrequency: template.frequency,
        recurringTemplateId: template.id,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function acknowledgePersonalTemplatePeriodAction(
  templateId: string,
): Promise<ActionState> {
  const userId = await requireUserId();

  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: templateId, userId },
  });
  if (!template) return { error: "Recurring template not found" };

  try {
    const periodKey = getPeriodKey(new Date(), template.frequency);
    await prisma.personalRecurringTemplateAck.upsert({
      where: {
        personalRecurringTemplateId_periodKey: {
          personalRecurringTemplateId: template.id,
          periodKey,
        },
      },
      create: { personalRecurringTemplateId: template.id, periodKey },
      update: {},
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function unacknowledgePersonalTemplatePeriodAction(
  templateId: string,
): Promise<ActionState> {
  const userId = await requireUserId();

  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: templateId, userId },
  });
  if (!template) return { error: "Recurring template not found" };

  try {
    const periodKey = getPeriodKey(new Date(), template.frequency);
    await prisma.personalRecurringTemplateAck.deleteMany({
      where: { personalRecurringTemplateId: template.id, periodKey },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}
