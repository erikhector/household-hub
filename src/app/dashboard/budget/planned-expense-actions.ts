"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { parseShareSplitFormData } from "@/lib/share-split-form";

// Planned bills (BUDGET-8): one-off bills with a due date. Kept out of
// actions.ts, which is already 1 000+ lines. Editing a bill never touches the
// transaction that paid it — fixing a typo on a paid bill is allowed.

const plannedExpenseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  categoryId: z.string().min(1, "Category is required"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid due date"),
});

// Same set as revalidateBudgetPages in actions.ts (not exported from a
// "use server" file): the bill shows on the budget, personal budget and the
// dashboard's safe-to-spend.
function revalidateBudgetPages() {
  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard/personal-budget");
  revalidatePath("/dashboard");
}

// Due dates are calendar days, stored at UTC noon so no timezone shifts the
// day. Returns null for an impossible date such as 2026-02-31.
function parseDueDate(value: string): Date | null {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function parsePlannedExpenseFields(formData: FormData) {
  return plannedExpenseSchema.safeParse({
    name: formData.get("name"),
    amount: formData.get("amount"),
    categoryId: formData.get("categoryId"),
    dueDate: formData.get("dueDate"),
  });
}

export async function createPlannedExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = parsePlannedExpenseFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const dueDate = parseDueDate(parsed.data.dueDate);
  if (!dueDate) return { error: "Invalid due date" };

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id, type: "EXPENSE" },
  });
  if (!category) return { error: "Category not found" };

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    "The split amounts must add up to the bill's amount",
  );
  if (split && "error" in split) return { error: split.error };

  try {
    await prisma.plannedExpense.create({
      data: {
        householdId: household.id,
        createdByUserId: userId,
        categoryId: category.id,
        name: parsed.data.name,
        amount: parsed.data.amount,
        dueDate,
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

  revalidateBudgetPages();
  return {};
}

export async function updatePlannedExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return { error: "Planned bill not found" };

  const parsed = parsePlannedExpenseFields(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const dueDate = parseDueDate(parsed.data.dueDate);
  if (!dueDate) return { error: "Invalid due date" };

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id, type: "EXPENSE" },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.plannedExpense.findFirst({
    where: { id: id.data, householdId: household.id },
  });
  if (!existing) return { error: "Planned bill not found" };

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    "The split amounts must add up to the bill's amount",
  );
  if (split && "error" in split) return { error: split.error };

  // Splits are replaced wholesale (delete-all then recreate) rather than
  // diffed, same convention updateRecurringTemplateAction uses.
  try {
    await prisma.$transaction([
      prisma.plannedExpenseSplit.deleteMany({ where: { plannedExpenseId: existing.id } }),
      prisma.plannedExpense.update({
        where: { id: existing.id },
        data: {
          name: parsed.data.name,
          amount: parsed.data.amount,
          categoryId: category.id,
          dueDate,
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

  revalidateBudgetPages();
  return {};
}

export async function deletePlannedExpenseAction(id: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    const { count } = await prisma.plannedExpense.deleteMany({
      where: { id, householdId: household.id },
    });
    if (count === 0) return { error: "Planned bill not found" };
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}
