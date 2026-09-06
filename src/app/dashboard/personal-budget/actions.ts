"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getPeriodKey } from "@/app/dashboard/budget/recurring-template-calc";
import type { ActionState } from "@/lib/actions/auth";

// --- Categories --------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  type: z.enum(["INCOME", "EXPENSE", "SAVINGS"]),
});

export async function createPersonalCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await prisma.personalBudgetCategory.findFirst({
    where: { userId, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return { error: "A category with that name already exists" };

  await prisma.personalBudgetCategory.create({
    data: { userId, name: parsed.data.name, type: parsed.data.type },
  });

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function deletePersonalCategoryAction(categoryId: string): Promise<ActionState> {
  const userId = await requireUserId();

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: categoryId, userId },
    include: { _count: { select: { transactions: true } } },
  });
  if (!category) return { error: "Category not found" };
  if (category._count.transactions > 0) {
    return { error: "This category has transactions and can't be deleted" };
  }

  await prisma.personalBudgetCategory.delete({ where: { id: category.id } });

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
  });
}

async function resolvePersonalRecurringTemplateId(
  userId: string,
  recurringTemplateId: string | undefined,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!recurringTemplateId) return { id: undefined };
  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: recurringTemplateId, userId },
    select: { id: true },
  });
  if (!template) return { error: "Recurring template not found" };
  return { id: template.id };
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

  await prisma.personalTransaction.create({
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
    },
  });

  revalidatePath("/dashboard/personal-budget");
  return {};
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
    select: { id: true },
  });
  if (!existing) return { error: "Transaction not found" };

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

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function deletePersonalTransactionAction(transactionId: string) {
  const userId = await requireUserId();

  await prisma.personalTransaction.deleteMany({
    where: { id: transactionId, userId },
  });

  revalidatePath("/dashboard/personal-budget");
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

  revalidatePath("/dashboard/personal-budget");
  return {};
}

export async function setPersonalRecurringTemplateActiveAction(
  templateId: string,
  active: boolean,
) {
  const userId = await requireUserId();

  await prisma.personalRecurringTemplate.updateMany({
    where: { id: templateId, userId },
    data: { active },
  });

  revalidatePath("/dashboard/personal-budget");
}

export async function deletePersonalRecurringTemplateAction(templateId: string) {
  const userId = await requireUserId();

  await prisma.personalRecurringTemplate.deleteMany({
    where: { id: templateId, userId },
  });

  revalidatePath("/dashboard/personal-budget");
}

export async function acknowledgePersonalTemplatePeriodAction(templateId: string) {
  const userId = await requireUserId();

  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: templateId, userId },
  });
  if (!template) return;

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

  revalidatePath("/dashboard/personal-budget");
}

export async function unacknowledgePersonalTemplatePeriodAction(templateId: string) {
  const userId = await requireUserId();

  const template = await prisma.personalRecurringTemplate.findFirst({
    where: { id: templateId, userId },
  });
  if (!template) return;

  const periodKey = getPeriodKey(new Date(), template.frequency);
  await prisma.personalRecurringTemplateAck.deleteMany({
    where: { personalRecurringTemplateId: template.id, periodKey },
  });

  revalidatePath("/dashboard/personal-budget");
}
