"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getPeriodBounds, getPeriodKey, type TemplateFrequency } from "@/lib/recurring-template-calc";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { isPlannedExpenseTarget, isUniqueViolation } from "@/lib/prisma-errors";
import { plannedItemType } from "@/lib/planned-expense-calc";
import {
  limitForType,
  monthlyLimitField,
  rolloverEnabledField,
  rolloverForLimit,
} from "@/lib/budget-category-limit";
import { goalAmountField, goalDateField, goalForType } from "@/lib/savings-goal-calc";
import { MAX_BUDGET_MONTH_START_DAY, MIN_BUDGET_MONTH_START_DAY } from "@/lib/budget-date-utils";
import { getPersonalBudgetStartDay } from "@/lib/personal-budget-period";

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

// BUDGET-5: the personal counterpart of the household budget's
// createStarterCategoriesAction (same schema and dedupe rules), scoped by the
// caller's userId. Names are skipped case-insensitively against the user's
// existing categories and within the batch, so a double click or a re-pick
// never errors. Starter categories carry no limit, rollover or goal.
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

export async function createPersonalStarterCategoriesAction(
  items: { name: string; type: "INCOME" | "EXPENSE" | "SAVINGS" }[],
): Promise<{ error?: string; added?: number }> {
  const userId = await requireUserId();

  const parsed = starterCategorySchema.safeParse({ items });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  let added = 0;
  try {
    const existing = await prisma.personalBudgetCategory.findMany({
      where: { userId },
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
      await prisma.personalBudgetCategory.createMany({
        data: toAdd.map((item) => ({ userId, name: item.name, type: item.type })),
      });
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return { added };
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
  if (blockingPlanned) {
    return fail(category.type === "INCOME" ? "categoryUsedByPlannedIncome" : "categoryUsedByPlannedBill", {
      name: blockingPlanned.name,
    });
  }

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
 * caller, isn't already paid (a planned bill has at most one payment) and
 * is logged in a category of its own type — the personal mirror of
 * budget/actions.ts's resolvePlannedExpenseId, which says why. */
async function resolvePersonalPlannedExpenseId(
  userId: string,
  plannedExpenseId: string | undefined,
  categoryType: string,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!plannedExpenseId) return { id: undefined };
  const planned = await prisma.personalPlannedExpense.findFirst({
    where: { id: plannedExpenseId, userId },
    select: { id: true, category: { select: { type: true } }, transaction: { select: { id: true } } },
  });
  if (!planned) return fail("plannedBillNotFound");
  const income = plannedItemType(planned.category.type) === "INCOME";
  if (planned.transaction) return fail(income ? "plannedIncomeAlreadyReceived" : "plannedBillAlreadyPaid");
  if (categoryType !== planned.category.type) {
    return fail(income ? "plannedIncomeNeedsIncomeCategory" : "plannedBillNeedsExpenseCategory");
  }
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
 * but the same race is possible between them. `startDay` is the user's
 * Personal Budget month start day, which decides what a MONTHLY template's
 * period is — the same one the page's statuses use. */
async function assertNoDuplicatePersonalTemplatePeriod(
  recurringTemplateId: string,
  frequency: TemplateFrequency,
  date: Date,
  startDay: number,
): Promise<{ error: string } | null> {
  const periodKey = getPeriodKey(date, frequency, startDay);
  // Bounded to the period's date range — see budget/actions.ts (PERF-17).
  const { start, end } = getPeriodBounds(date, frequency, startDay);
  const existing = await prisma.personalTransaction.findMany({
    where: { recurringTemplateId, date: { gte: start, lt: end } },
    select: { date: true },
  });
  const alreadyLogged = existing.some((t) => getPeriodKey(t.date, frequency, startDay) === periodKey);
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
      await getPersonalBudgetStartDay(userId),
    );
    if (dup) return dup;
  }

  const planned = await resolvePersonalPlannedExpenseId(userId, parsed.data.plannedExpenseId, category.type);
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
    select: { id: true, plannedExpense: { select: { category: { select: { type: true } } } } },
  });
  if (!existing) return { error: "Transaction not found" };
  // Same rule as on create: a planned bill's payment stays an expense,
  // received planned income stays income.
  const plannedType = existing.plannedExpense?.category.type;
  if (plannedType && category.type !== plannedType) {
    return fail(
      plannedItemType(plannedType) === "INCOME" ? "plannedIncomeNeedsIncomeCategory" : "plannedBillNeedsExpenseCategory",
    );
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

  const dup = await assertNoDuplicatePersonalTemplatePeriod(
    template.id,
    template.frequency,
    new Date(),
    await getPersonalBudgetStartDay(userId),
  );
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
    const periodKey = getPeriodKey(new Date(), template.frequency, await getPersonalBudgetStartDay(userId));
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
    const periodKey = getPeriodKey(new Date(), template.frequency, await getPersonalBudgetStartDay(userId));
    await prisma.personalRecurringTemplateAck.deleteMany({
      where: { personalRecurringTemplateId: template.id, periodKey },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/personal-budget");
  return {};
}

// --- Budget month start day ------------------------------------------------

/**
 * Sets the day the user's Personal Budget month starts on (1 to 28; 25 for a
 * payday month, the 25th to the 24th) — the personal counterpart of
 * setBudgetMonthStartDayAction (src/lib/actions/household.ts). The personal
 * budget is the user's alone, so there's no owner check: it's scoped to the
 * session's user and moves nobody else's months. Nothing stored changes,
 * since transactions keep their dates and only which period each falls in
 * does. A click action (the Manage tab's select saves on change), so it takes
 * the value directly.
 */
export async function setPersonalBudgetMonthStartDayAction(day: number): Promise<ActionState> {
  const userId = await requireUserId();

  const parsed = z
    .number()
    .int()
    .min(MIN_BUDGET_MONTH_START_DAY)
    .max(MAX_BUDGET_MONTH_START_DAY)
    .safeParse(day);
  if (!parsed.success) return { error: "Choose a day from 1 to 28" };

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { personalBudgetMonthStartDay: parsed.data },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  // The Personal Budget page and the overview's "Your budget" card read it.
  revalidatePath("/dashboard/personal-budget");
  revalidatePath("/dashboard");
  return {};
}
