"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { parseDueDate } from "@/lib/planned-expense-calc";

// Personal planned bills: the personal budget's mirror of the household's
// (src/app/dashboard/budget/planned-expense-actions.ts), scoped by the
// signed-in user instead of a household and with no split, since only the
// user ever sees or pays one. Editing a bill never touches the transaction
// that paid it, same as the household's.

const plannedExpenseSchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(100, v("billNameTooLong")),
  amount: z.coerce.number().positive(v("amountPositive")),
  categoryId: z.string().min(1, v("categoryRequired")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDueDate")),
});

// The bill counts in Remaining on the personal budget and on the
// dashboard's "Your budget" card, which share loadPersonalBudgetPosition.
function revalidatePersonalBudgetPages() {
  revalidatePath("/dashboard/personal-budget");
  revalidatePath("/dashboard");
}

/** The validated fields, or a localised `{ error }`. The category must be
 * one of the user's own expense categories. */
async function parsePlannedExpense(
  userId: string,
  formData: FormData,
): Promise<{ error: string } | { name: string; amount: number; categoryId: string; dueDate: Date }> {
  const parsed = plannedExpenseSchema.safeParse({
    name: formData.get("name"),
    amount: formData.get("amount"),
    categoryId: formData.get("categoryId"),
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) return zodFail(parsed.error);
  const dueDate = parseDueDate(parsed.data.dueDate);
  if (!dueDate) return fail("invalidDueDate");

  const category = await prisma.personalBudgetCategory.findFirst({
    where: { id: parsed.data.categoryId, userId, type: "EXPENSE" },
    select: { id: true },
  });
  if (!category) return fail("categoryNotFound");

  return { name: parsed.data.name, amount: parsed.data.amount, categoryId: category.id, dueDate };
}

export async function createPersonalPlannedExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const fields = await parsePlannedExpense(userId, formData);
  if ("error" in fields) return fields;

  try {
    await prisma.personalPlannedExpense.create({ data: { userId, ...fields } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePersonalBudgetPages();
  return {};
}

export async function updatePersonalPlannedExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return fail("plannedBillNotFound");

  const fields = await parsePlannedExpense(userId, formData);
  if ("error" in fields) return fields;

  try {
    // updateMany so the user scope sits in the same query as the write: a
    // bill id of another user's matches nothing.
    const { count } = await prisma.personalPlannedExpense.updateMany({
      where: { id: id.data, userId },
      data: fields,
    });
    if (count === 0) return fail("plannedBillNotFound");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePersonalBudgetPages();
  return {};
}

export async function deletePersonalPlannedExpenseAction(id: string): Promise<ActionState> {
  const userId = await requireUserId();

  try {
    const { count } = await prisma.personalPlannedExpense.deleteMany({
      where: { id, userId },
    });
    if (count === 0) return fail("plannedBillNotFound");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePersonalBudgetPages();
  return {};
}
