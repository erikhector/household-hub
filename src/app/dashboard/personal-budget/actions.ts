"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";

// --- Categories --------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  type: z.enum(["INCOME", "EXPENSE"]),
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
});

function parseTransactionFormData(formData: FormData) {
  return transactionSchema.safeParse({
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    description: formData.get("description") || undefined,
    date: formData.get("date"),
    isRecurring: formData.get("isRecurring") === "on",
    recurrenceFrequency: formData.get("recurrenceFrequency") || undefined,
  });
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
