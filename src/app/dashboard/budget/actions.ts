"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold, requireUserId } from "@/lib/session";
import { getPeriodBounds, getPeriodKey, type TemplateFrequency } from "@/lib/recurring-template-calc";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { parseShareSplitFormData, SPLIT_SUM_TOLERANCE } from "@/lib/share-split-form";
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const existing = await prisma.budgetCategory.findFirst({
    where: { householdId: household.id, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (existing) return { error: "A category with that name already exists" };

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
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.id, householdId: household.id },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.budgetCategory.findFirst({
    where: {
      householdId: household.id,
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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
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
    await prisma.budgetCategory.delete({ where: { id: category.id } });
  } catch (error) {
    return toFriendlyError(error);
  }

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
  // Set when this transaction is being logged from a recurring template's
  // "Log transaction" action (see RecurringTemplatesPanel) — links the two
  // so the template's checklist can see this period is fulfilled. Validated
  // against the caller's household below, same as categoryId.
  recurringTemplateId: z.string().optional(),
  // Set when logging a payment against a planned bill (BUDGET-8). Only
  // createTransactionAction reads it; the other callers of
  // parseTransactionFormData ignore it. Household-checked below.
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
 * caller's household and isn't already paid (a planned bill has at most one
 * payment transaction). Returns `undefined` id when not provided. */
async function resolvePlannedExpenseId(
  householdId: string,
  plannedExpenseId: string | undefined,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!plannedExpenseId) return { id: undefined };
  const planned = await prisma.plannedExpense.findFirst({
    where: { id: plannedExpenseId, householdId },
    select: { id: true, transaction: { select: { id: true } } },
  });
  if (!planned) return fail("plannedBillNotFound");
  if (planned.transaction) return fail("plannedBillAlreadyPaid");
  return { id: planned.id };
}

/** Validates an optional client-supplied recurringTemplateId actually
 * belongs to the caller's household before it's ever written to a
 * transaction. Returns `undefined` (not provided), the validated id (plus
 * its frequency, needed by assertNoDuplicateTemplatePeriod below), or an
 * error. */
async function resolveRecurringTemplateId(
  householdId: string,
  recurringTemplateId: string | undefined,
): Promise<{ error: string } | { id: undefined } | { id: string; frequency: TemplateFrequency }> {
  if (!recurringTemplateId) return { id: undefined };
  const template = await prisma.recurringTemplate.findFirst({
    where: { id: recurringTemplateId, householdId },
    select: { id: true, frequency: true },
  });
  if (!template) return { error: "Recurring template not found" };
  return { id: template.id, frequency: template.frequency };
}

/**
 * Guards against the same recurring template being logged twice for the
 * same period — the same period-matching logic computeTemplateStatuses
 * (src/lib/recurring-template-calc.ts) uses to derive "posted" at read time,
 * enforced here at write time too. Needed because a template's period can be
 * logged from three independent entry points (the household budget's "Log
 * as-is"/"Log transaction", and Personal Budget's "Log payment" via
 * createSharedExpenseFromPersonalBudgetAction below) that don't otherwise
 * know about each other within one request — e.g. two household members
 * racing each other, or Personal Budget's due-row widget being a request
 * behind the household budget's own revalidation.
 */
async function assertNoDuplicateTemplatePeriod(
  recurringTemplateId: string,
  frequency: TemplateFrequency,
  date: Date,
): Promise<{ error: string } | null> {
  const periodKey = getPeriodKey(date, frequency);
  // Bounded to the period's date range so the read doesn't grow with every
  // period the template has ever been logged in (PERF-17). The key check
  // below stays as the exact definition of "same period".
  const { start, end } = getPeriodBounds(date, frequency);
  const existing = await prisma.transaction.findMany({
    where: { recurringTemplateId, date: { gte: start, lt: end } },
    select: { date: true },
  });
  const alreadyLogged = existing.some((t) => getPeriodKey(t.date, frequency) === periodKey);
  return alreadyLogged
    ? { error: "A transaction for this recurring item already exists for this period" }
    : null;
}

type ParsedSplit = { householdMemberId: string; amountOwed: number; amountPaid: number };

/**
 * Parses the optional "split this expense" section of the transaction form
 * — same repeated-input convention as the meal-planning ingredient rows
 * (`formData.getAll`, aligned by index): `splitMemberId`, `splitAmount` (the
 * member's share) and `splitPaid` (what they've paid towards the bill so far
 * — see TransactionSplit.amountPaid). Returns `null` when splitting wasn't
 * requested (the "splitEnabled" checkbox was off), so a plain transaction is
 * completely unaffected.
 *
 * Validates every referenced member actually belongs to the caller's
 * household (never trusts a client-supplied id beyond that check), that the
 * shares sum to the transaction's total amount, and that the payments don't
 * add up to more than it. Payments may add up to *less*: the rest is still
 * due on the bill (see src/lib/settle-up-calc.ts).
 */
async function parseSplitFormData(
  formData: FormData,
  householdId: string,
  amount: number,
): Promise<{ error: string } | { splits: ParsedSplit[] } | null> {
  if (formData.get("splitEnabled") !== "on") return null;

  const memberIds = formData.getAll("splitMemberId").map((v) => String(v));
  const amounts = formData.getAll("splitAmount").map((v) => Number(v));
  // An empty "paid" input means nothing paid yet, not an invalid number.
  const paid = formData.getAll("splitPaid").map((v) => (String(v).trim() === "" ? 0 : Number(v)));
  if (memberIds.length === 0 || memberIds.length !== amounts.length || memberIds.length !== paid.length) {
    return { error: "Invalid split" };
  }
  if (new Set(memberIds).size !== memberIds.length) {
    return { error: "Invalid split" };
  }
  if (amounts.some((a) => Number.isNaN(a) || a < 0)) {
    return { error: "Each split amount must be zero or more" };
  }
  if (paid.some((a) => Number.isNaN(a) || a < 0)) {
    return { error: "Each paid amount must be zero or more" };
  }

  const validMembers = await prisma.householdMember.findMany({
    where: { id: { in: memberIds }, householdId },
    select: { id: true },
  });
  if (validMembers.length !== memberIds.length) {
    return { error: "One of the selected members no longer belongs to this household" };
  }

  const splitTotal = amounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(splitTotal - amount) > SPLIT_SUM_TOLERANCE) {
    return { error: "The split amounts must add up to the transaction total" };
  }
  const paidTotal = paid.reduce((sum, a) => sum + a, 0);
  if (paidTotal - amount > SPLIT_SUM_TOLERANCE) {
    return { error: "The paid amounts can't add up to more than the transaction total" };
  }

  return {
    splits: memberIds
      .map((householdMemberId, i) => ({ householdMemberId, amountOwed: amounts[i], amountPaid: paid[i] }))
      // A member with no share who paid nothing isn't part of this bill at
      // all — dropping the row keeps "who's in this split" meaningful.
      .filter((s) => s.amountOwed > 0 || s.amountPaid > 0),
  };
}

/** Every page that reads split transactions or repayments: the household
 * budget, Personal Budget (your share, "owed from earlier months") and the
 * dashboard's "Your budget" card (the same number). */
function revalidateBudgetPages() {
  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard/personal-budget");
  revalidatePath("/dashboard");
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

  const split = await parseSplitFormData(formData, household.id, parsed.data.amount);
  if (split && "error" in split) return { error: split.error };

  const recurringTemplate = await resolveRecurringTemplateId(
    household.id,
    parsed.data.recurringTemplateId,
  );
  if ("error" in recurringTemplate) return { error: recurringTemplate.error };
  if (recurringTemplate.id) {
    const dup = await assertNoDuplicateTemplatePeriod(
      recurringTemplate.id,
      recurringTemplate.frequency,
      new Date(parsed.data.date),
    );
    if (dup) return dup;
  }

  // A planned bill is an expense by definition (its own category must be
  // one); paying it from an income or savings category would count it as
  // paid while the money shows up on the wrong side of the budget.
  if (parsed.data.plannedExpenseId && category.type !== "EXPENSE") {
    return fail("plannedBillNeedsExpenseCategory");
  }
  const planned = await resolvePlannedExpenseId(household.id, parsed.data.plannedExpenseId);
  if ("error" in planned) return { error: planned.error };

  try {
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
        recurringTemplateId: recurringTemplate.id ?? null,
        plannedExpenseId: planned.id ?? null,
        splits: split ? { create: split.splits } : undefined,
      },
    });
  } catch (error) {
    // Two members paying the same bill at once both pass the pre-check; the
    // unique index on plannedExpenseId rejects the loser.
    if (isUniqueViolation(error) && isPlannedExpenseTarget(error)) {
      return fail("plannedBillAlreadyPaid");
    }
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}

/**
 * Whether a P2002 came from the unique index on plannedExpenseId. With the pg
 * driver adapter (Prisma 7) there is no `meta.target`: the violated
 * constraint sits at `meta.driverAdapterError.cause.constraint`, as `fields`
 * or, since Postgres always names its constraint, as `index`
 * ("Transaction_plannedExpenseId_key"). `meta.target` is kept as a fallback.
 */
function isPlannedExpenseTarget(error: unknown): boolean {
  const meta = (error as {
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
    };
  }).meta;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const candidates: unknown[] = [
    ...(Array.isArray(constraint?.fields) ? constraint.fields : []),
    constraint?.index,
    ...(Array.isArray(meta?.target) ? meta.target : [meta?.target]),
  ];
  return candidates.some((c) => typeof c === "string" && c.includes("plannedExpenseId"));
}

/**
 * Logs a shared household expense from Personal Budget's "Log a shared
 * expense" dialog (LogSharedExpenseDialog) — the entry-point half of
 * docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md's read-only surfacing (wave A/B/C
 * already covers "shared costs show up in my personal budget"; this covers
 * "let me register one from my personal budget").
 *
 * This creates exactly the same kind of `Transaction` + `TransactionSplit`
 * rows `createTransactionAction` does — the household budget stays the one
 * ledger of record, per docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §2 ("two ledgers,
 * one bill, no sync" is the failure mode this avoids). Personal Budget is
 * just an alternate place to originate that single write; nothing is copied
 * into a `PersonalTransaction`. The split is mandatory here (unlike
 * `createTransactionAction`'s opt-in checkbox) since "shared expense" is the
 * whole point of this entry point — every row must be split.
 *
 * Uses `requireUserId()` rather than `requireHousehold()` so this isn't tied
 * to whichever household happens to be "active" elsewhere in the app — the
 * caller supplies which of the user's households the expense belongs to,
 * and membership is checked directly against that choice.
 */
export async function createSharedExpenseFromPersonalBudgetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await requireUserId();

  const householdId = String(formData.get("householdId") || "");
  const member = householdId
    ? await prisma.householdMember.findFirst({ where: { userId, householdId } })
    : null;
  if (!member) return { error: "Choose a household you belong to" };

  const parsed = parseTransactionFormData(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId },
  });
  if (!category) return { error: "Category not found" };

  const split = await parseSplitFormData(formData, householdId, parsed.data.amount);
  if (!split) return { error: "Choose how to split this expense" };
  if ("error" in split) return { error: split.error };

  // Set when this is "Log payment" on a shared bill's due row: links the
  // transaction to the template so the bill reads as logged for the period
  // (validated against the chosen household, never trusted from the client).
  const recurringTemplate = await resolveRecurringTemplateId(
    householdId,
    parsed.data.recurringTemplateId,
  );
  if ("error" in recurringTemplate) return { error: recurringTemplate.error };
  if (recurringTemplate.id) {
    const dup = await assertNoDuplicateTemplatePeriod(
      recurringTemplate.id,
      recurringTemplate.frequency,
      new Date(parsed.data.date),
    );
    if (dup) return dup;
  }

  try {
    await prisma.transaction.create({
      data: {
        householdId,
        categoryId: category.id,
        amount: parsed.data.amount,
        type: category.type,
        description: parsed.data.description || null,
        date: new Date(parsed.data.date),
        isRecurring: parsed.data.isRecurring,
        recurrenceFrequency: parsed.data.isRecurring ? parsed.data.recurrenceFrequency : null,
        createdByUserId: userId,
        recurringTemplateId: recurringTemplate.id ?? null,
        splits: { create: split.splits },
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
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

  const existing = await prisma.transaction.findFirst({
    where: { id: parsed.data.id, householdId: household.id },
    select: { id: true },
  });
  if (!existing) return { error: "Transaction not found" };

  const split = await parseSplitFormData(formData, household.id, parsed.data.amount);
  if (split && "error" in split) return { error: split.error };

  // Splits are replaced wholesale (delete-all then recreate) rather than
  // diffed, same convention as recipe ingredient editing — simpler, and
  // fine at this scale (a handful of members per household).
  try {
    await prisma.$transaction([
      prisma.transactionSplit.deleteMany({ where: { transactionId: existing.id } }),
      prisma.transaction.update({
        where: { id: existing.id },
        data: {
          categoryId: category.id,
          amount: parsed.data.amount,
          type: category.type,
          description: parsed.data.description || null,
          date: new Date(parsed.data.date),
          isRecurring: parsed.data.isRecurring,
          recurrenceFrequency: parsed.data.isRecurring ? parsed.data.recurrenceFrequency : null,
          splits: split ? { create: split.splits } : undefined,
        },
      }),
    ]);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}

export async function deleteTransactionAction(transactionId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.transaction.deleteMany({
      where: { id: transactionId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}

// --- Recurring templates --------------------------------------------------
// See prisma/schema.prisma's RecurringTemplate/RecurringTemplateAck doc
// comments and src/lib/recurring-template-calc.ts for the "accounted for" model.

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

export async function createRecurringTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = parseRecurringTemplateFormData(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return { error: "Category not found" };

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
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const category = await prisma.budgetCategory.findFirst({
    where: { id: parsed.data.categoryId, householdId: household.id },
  });
  if (!category) return { error: "Category not found" };

  const existing = await prisma.recurringTemplate.findFirst({
    where: { id: parsed.data.id, householdId: household.id },
  });
  if (!existing) return { error: "Recurring template not found" };

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
  if (!template) return { error: "Recurring template not found" };

  const periodKey = getPeriodKey(new Date(), template.frequency);
  try {
    await prisma.recurringTemplateAck.upsert({
      where: { recurringTemplateId_periodKey: { recurringTemplateId: template.id, periodKey } },
      create: { recurringTemplateId: template.id, periodKey, createdByUserId: userId },
      update: {},
    });
  } catch (error) {
    return toFriendlyError(error);
  }

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
  if (!template) return { error: "Recurring template not found" };

  const dup = await assertNoDuplicateTemplatePeriod(template.id, template.frequency, new Date());
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

  revalidateBudgetPages();
  return {};
}

/** Undoes acknowledgeTemplatePeriodAction for the current period. */
export async function unacknowledgeTemplatePeriodAction(templateId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
  });
  if (!template) return { error: "Recurring template not found" };

  const periodKey = getPeriodKey(new Date(), template.frequency);
  try {
    await prisma.recurringTemplateAck.deleteMany({
      where: { recurringTemplateId: template.id, periodKey },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
  return {};
}

// --- Settling up between members ---------------------------------------------
// See MemberSettlement's doc comment in schema.prisma and HouseholdBalances
// ("Clear debt"). Balances carry over between months until one of these
// clears them.

const settlementSchema = z.object({
  fromMemberId: z.string().min(1, "Choose who paid"),
  toMemberId: z.string().min(1, "Choose who was paid"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  date: z.string().min(1, "Date is required"),
});

/**
 * Records that one member paid another back ("Clear debt"). A form action:
 * the dialog pre-fills the suggested transfer from simplifyDebts, and the
 * amount can be lowered for a partial repayment. Both members are
 * re-checked against the caller's own household — never trusted from the
 * client — and the amount isn't capped at the current debt, since a
 * rounded-up repayment is a real thing that happens; any excess simply
 * shows up as a balance in the other direction.
 */
export async function recordSettlementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = settlementSchema.safeParse({
    fromMemberId: formData.get("fromMemberId"),
    toMemberId: formData.get("toMemberId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return { error: "Choose two different members" };
  }

  const members = await prisma.householdMember.findMany({
    where: {
      id: { in: [parsed.data.fromMemberId, parsed.data.toMemberId] },
      householdId: household.id,
    },
    select: { id: true },
  });
  if (members.length !== 2) {
    return { error: "One of the selected members no longer belongs to this household" };
  }

  try {
    await prisma.memberSettlement.create({
      data: {
        householdId: household.id,
        fromMemberId: parsed.data.fromMemberId,
        toMemberId: parsed.data.toMemberId,
        amount: parsed.data.amount,
        date: new Date(parsed.data.date),
        createdByUserId: userId,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}

/** Undoes a recorded repayment (e.g. entered by mistake). */
export async function deleteSettlementAction(settlementId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.memberSettlement.deleteMany({
      where: { id: settlementId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidateBudgetPages();
  return {};
}
