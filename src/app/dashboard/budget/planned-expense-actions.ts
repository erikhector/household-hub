"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail, type ErrorKey } from "@/lib/actions/errors";
import { parseShareSplitFormData } from "@/lib/share-split-form";

// Planned bills (BUDGET-8): one-off bills with a due date. Kept out of
// actions.ts, which is already 1 000+ lines. Editing a bill never touches the
// transaction that paid it — fixing a typo on a paid bill is allowed.

const plannedExpenseSchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(100, v("billNameTooLong")),
  amount: z.coerce.number().positive(v("amountPositive")),
  categoryId: z.string().min(1, v("categoryRequired")),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, v("invalidDueDate")),
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

// parseShareSplitFormData is shared with the not-yet-converted actions.ts and
// returns English text, so this file maps each message it can return to an
// `errors` key here rather than changing what actions.ts answers with. An
// unknown message falls back to "invalidInput" instead of leaking English.
const BILL_SPLIT_SUM_MISMATCH = "The split amounts must add up to the bill's amount";
const SPLIT_ERROR_KEYS: Record<string, ErrorKey> = {
  "Invalid split": "splitInvalid",
  "Each split amount must be zero or more": "splitAmountNegative",
  "One of the selected members no longer belongs to this household": "splitMemberGone",
  [BILL_SPLIT_SUM_MISMATCH]: "billSplitSumMismatch",
};

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
    return zodFail(parsed.error);
  }
  const dueDate = parseDueDate(parsed.data.dueDate);
  if (!dueDate) return fail("invalidDueDate");

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id, type: "EXPENSE" },
  });
  if (!category) return fail("categoryNotFound");

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    BILL_SPLIT_SUM_MISMATCH,
  );
  if (split && "error" in split) return fail(SPLIT_ERROR_KEYS[split.error] ?? "invalidInput");

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
  if (!id.success) return fail("plannedBillNotFound");

  const parsed = parsePlannedExpenseFields(formData);
  if (!parsed.success) {
    return zodFail(parsed.error);
  }
  const dueDate = parseDueDate(parsed.data.dueDate);
  if (!dueDate) return fail("invalidDueDate");

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id, type: "EXPENSE" },
  });
  if (!category) return fail("categoryNotFound");

  const existing = await prisma.plannedExpense.findFirst({
    where: { id: id.data, householdId: household.id },
  });
  if (!existing) return fail("plannedBillNotFound");

  const split = await parseShareSplitFormData(
    formData,
    household.id,
    parsed.data.amount,
    BILL_SPLIT_SUM_MISMATCH,
  );
  if (split && "error" in split) return fail(SPLIT_ERROR_KEYS[split.error] ?? "invalidInput");

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
    if (count === 0) return fail("plannedBillNotFound");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}
