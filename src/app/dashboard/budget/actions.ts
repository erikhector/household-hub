"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";

// The category name/lookup key the shopping-list → budget link (Wave 2,
// Task 8) is expected to use via findOrCreateGroceriesCategory below — see
// REQUIREMENTS.md's "Budgeting" section for the documented contract.
//
// Not exported: a "use server" file may only export async functions, so
// this stays a module-private constant — callers get it indirectly through
// the category `findOrCreateGroceriesCategory` returns (`category.name`).
const GROCERIES_CATEGORY_NAME = "Groceries";

/**
 * Find-or-create the household's "Groceries" expense category, mirroring
 * `findOrCreateInventoryItem` in `src/app/dashboard/shopping-list/actions.ts`
 * (case-insensitive name match scoped to the household; creates it if
 * missing). Exported for the shopping-list → budget expense link (Wave 2,
 * Task 8) to reuse instead of duplicating this lookup.
 *
 * Like `findOrCreateInventoryItem`, this trusts its `householdId` argument
 * and performs no auth check of its own — every caller must already have
 * resolved that id from its own `requireHousehold()` call (never pass a
 * client-supplied household id through to this function).
 */
export async function findOrCreateGroceriesCategory(householdId: string) {
  const existing = await prisma.budgetCategory.findFirst({
    where: {
      householdId,
      type: "EXPENSE",
      name: { equals: GROCERIES_CATEGORY_NAME, mode: "insensitive" },
    },
  });
  if (existing) return existing;

  return prisma.budgetCategory.create({
    data: { householdId, name: GROCERIES_CATEGORY_NAME, type: "EXPENSE" },
  });
}

// --- Categories --------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  type: z.enum(["INCOME", "EXPENSE"]),
});

export async function createCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await prisma.budgetCategory.findFirst({
    where: { householdId: household.id, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return { error: "A category with that name already exists" };

  await prisma.budgetCategory.create({
    data: { householdId: household.id, name: parsed.data.name, type: parsed.data.type },
  });

  revalidatePath("/dashboard/budget");
  return {};
}

export async function deleteCategoryAction(categoryId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const category = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, householdId: household.id },
    include: { _count: { select: { transactions: true } } },
  });
  if (!category) return { error: "Category not found" };
  if (category._count.transactions > 0) {
    return { error: "This category has transactions and can't be deleted" };
  }

  await prisma.budgetCategory.delete({ where: { id: category.id } });

  revalidatePath("/dashboard/budget");
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

export async function createTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = parseTransactionFormData(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.isRecurring && !parsed.data.recurrenceFrequency) {
    return { error: "Choose how often this repeats" };
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return { error: "Category not found" };

  await prisma.transaction.create({
    data: {
      householdId: household.id,
      categoryId: category.id,
      amount: parsed.data.amount,
      // Derived from the category rather than taken as a separate field, so
      // a transaction can never disagree with its own category's type.
      type: category.type,
      description: parsed.data.description || null,
      date: new Date(parsed.data.date),
      isRecurring: parsed.data.isRecurring,
      recurrenceFrequency: parsed.data.isRecurring ? parsed.data.recurrenceFrequency : null,
      createdByUserId: userId,
    },
  });

  revalidatePath("/dashboard/budget");
  return {};
}

const updateTransactionSchema = transactionSchema.extend({
  id: z.string().min(1),
});

export async function updateTransactionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

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

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return { error: "Category not found" };

  const result = await prisma.transaction.updateMany({
    where: { id: parsed.data.id, householdId: household.id },
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
  if (result.count === 0) return { error: "Transaction not found" };

  revalidatePath("/dashboard/budget");
  return {};
}

export async function deleteTransactionAction(transactionId: string) {
  const { household } = await requireHousehold();

  await prisma.transaction.deleteMany({
    where: { id: transactionId, householdId: household.id },
  });

  revalidatePath("/dashboard/budget");
}
