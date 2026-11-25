"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import {
  limitForType,
  monthlyLimitField,
  rolloverEnabledField,
  rolloverForLimit,
} from "@/lib/budget-category-limit";
import { goalAmountField, goalDateField, goalForType } from "@/lib/savings-goal-calc";

// --- Categories --------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(60, v("categoryNameTooLong")),
  type: z.enum(["INCOME", "EXPENSE", "SAVINGS"]),
  // GAP-12 — see src/lib/budget-category-limit.ts. Empty = no limit.
  monthlyLimit: monthlyLimitField,
  // GAP-21 — see src/lib/budget-rollover-calc.ts. Kept only with a limit.
  rolloverEnabled: rolloverEnabledField,
  // GAP-22 — see src/lib/savings-goal-calc.ts. Kept only on SAVINGS.
  goalAmount: goalAmountField,
  goalDate: goalDateField,
});

export async function createCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    monthlyLimit: formData.get("monthlyLimit"),
    rolloverEnabled: formData.get("rolloverEnabled"),
    goalAmount: formData.get("goalAmount"),
    goalDate: formData.get("goalDate"),
  });
  if (!parsed.success) {
    return zodFail(parsed.error);
  }

  const existing = await prisma.budgetCategory.findFirst({
    where: { householdId: household.id, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return fail("categoryNameTaken");

  const monthlyLimit = limitForType(parsed.data.type, parsed.data.monthlyLimit);
  const goal = goalForType(parsed.data.type, parsed.data.goalAmount, parsed.data.goalDate);
  try {
    await prisma.budgetCategory.create({
      data: {
        householdId: household.id,
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

  revalidatePath("/dashboard/budget");
  return {};
}

const updateCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, v("nameRequired")).max(60, v("categoryNameTooLong")),
  // A category's type can't be edited, so whether this is kept is decided
  // by the stored type below, not by anything the form sends.
  monthlyLimit: monthlyLimitField,
  rolloverEnabled: rolloverEnabledField,
  // GAP-22 — see src/lib/savings-goal-calc.ts. Kept only on SAVINGS.
  goalAmount: goalAmountField,
  goalDate: goalDateField,
});

export async function updateCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = updateCategorySchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    monthlyLimit: formData.get("monthlyLimit"),
    rolloverEnabled: formData.get("rolloverEnabled"),
    goalAmount: formData.get("goalAmount"),
    goalDate: formData.get("goalDate"),
  });
  if (!parsed.success) {
    return zodFail(parsed.error);
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.id, householdId: household.id },
  });
  if (!category) return fail("categoryNotFound");

  const existing = await prisma.budgetCategory.findFirst({
    where: {
      householdId: household.id,
      name: { equals: parsed.data.name, mode: "insensitive" },
      NOT: { id: category.id },
    },
  });
  if (existing) return fail("categoryNameTaken");

  const monthlyLimit = limitForType(category.type, parsed.data.monthlyLimit);
  // Decided from the stored type like the limit above: a category's type
  // can't be edited, so an income/expense category can never gain a goal
  // (or keep a stale one) whatever the form sends.
  const goal = goalForType(category.type, parsed.data.goalAmount, parsed.data.goalDate);
  try {
    await prisma.budgetCategory.update({
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

  revalidatePath("/dashboard/budget");
  return {};
}

const starterCategorySchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        type: z.enum(["INCOME", "EXPENSE", "SAVINGS"]),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * One-click "starter set" of common budget categories — Budget's equivalent
 * of `addStarterKitItemsAction` in src/app/dashboard/inventory/actions.ts.
 * Like that action, the caller (StarterCategoryPicker) supplies the already-
 * localized names and their type straight from the locale dictionary
 * (`dict.budget.starterCategories.items`) rather than this action looking
 * anything up itself, and every item is created in one household-scoped
 * batch. Case-insensitively deduped both against categories the household
 * already has and within the batch itself (keeping the first occurrence),
 * same convention as createInventoryItemAction's dedupe.
 */
export async function createStarterCategoriesAction(
  items: { name: string; type: "INCOME" | "EXPENSE" | "SAVINGS" }[],
): Promise<{ error?: string; added?: number }> {
  const { household } = await requireHousehold();

  const parsed = starterCategorySchema.safeParse({ items });
  if (!parsed.success) {
    return zodFail(parsed.error);
  }

  let added = 0;
  try {
    const existing = await prisma.budgetCategory.findMany({
      where: { householdId: household.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));

    const seen = new Set<string>();
    const toAdd = parsed.data.items.filter((item) => {
      const key = item.name.toLowerCase();
      if (existingNames.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (toAdd.length > 0) {
      await prisma.budgetCategory.createMany({
        data: toAdd.map((item) => ({
          householdId: household.id,
          name: item.name,
          type: item.type,
        })),
      });
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
  return { added };
}

export async function deleteCategoryAction(categoryId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const category = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, householdId: household.id },
    include: {
      _count: { select: { transactions: true } },
      // Named in the error below rather than just failing generically — a
      // category can have a blocking RecurringTemplate with zero
      // transactions of its own (the transactions count above only catches
      // the category's *own* logged transactions), which would otherwise
      // hit BudgetCategory→RecurringTemplate's FK restrict and surface as
      // an opaque "something went wrong". `active` first so a live template
      // is named ahead of a paused one when a category has both.
      recurringTemplates: { select: { name: true }, orderBy: { active: "desc" }, take: 1 },
      // Same reason for planned bills (BUDGET-8): PlannedExpense→BudgetCategory
      // is Restrict too, and an unpaid bill has no transaction to trip the
      // count above (nor does a paid one whose payment went to another
      // category).
      plannedExpenses: { select: { name: true }, take: 1 },
    },
  });
  if (!category) return fail("categoryNotFound");
  if (category._count.transactions > 0) {
    return fail("categoryHasTransactions");
  }
  const blockingTemplate = category.recurringTemplates[0];
  if (blockingTemplate) {
    return fail("categoryUsedByRecurringItem", { name: blockingTemplate.name });
  }
  const blockingPlanned = category.plannedExpenses[0];
  if (blockingPlanned) {
    return fail(category.type === "INCOME" ? "categoryUsedByPlannedIncome" : "categoryUsedByPlannedBill", {
      name: blockingPlanned.name,
    });
  }

  try {
    await prisma.budgetCategory.delete({ where: { id: category.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
  return {};
}
