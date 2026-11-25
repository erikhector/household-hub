"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold, requireUserId } from "@/lib/session";
import type { TemplateFrequency } from "@/lib/recurring-template-calc";
import { normalizeStartDay } from "@/lib/budget-date-utils";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError } from "@/lib/actions/errors";
import { isPlannedExpenseTarget, isUniqueViolation } from "@/lib/prisma-errors";
import { plannedItemType } from "@/lib/planned-expense-calc";
import { SPLIT_SUM_TOLERANCE } from "@/lib/share-split-form";
import { repeatTemplateFields } from "@/lib/repeat-template";
import { assertNoDuplicateTemplatePeriod, revalidateBudgetPages, type ParsedSplit } from "./action-helpers";
import { invalidateHome } from "@/lib/household-cache";

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
  // UX-179: the Add transaction sheet's "Repeats" switch. On a plain new
  // transaction it also creates a monthly recurring item from it (see
  // repeatTemplateFields) and links the two, so the item starts the period
  // as Logged. Ignored when the row is already a payment against a
  // recurring item or a planned bill, which have their own item.
  repeatsMonthly: z.boolean().optional(),
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
    repeatsMonthly: formData.get("repeatsMonthly") === "on",
  });
}

/** Validates an optional client-supplied plannedExpenseId belongs to the
 * caller's household and isn't already paid (a planned bill has at most one
 * payment transaction), and that the transaction's category has the planned
 * item's type: a bill is paid from an expense category, planned income is
 * received into an income one. Logging it on the other side of the budget
 * would mark it settled (so it leaves Safe to spend's due rows) while the
 * money counts the wrong way round — the number off by about twice the
 * amount. Returns `undefined` id when not provided. */
async function resolvePlannedExpenseId(
  householdId: string,
  plannedExpenseId: string | undefined,
  categoryType: string,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!plannedExpenseId) return { id: undefined };
  const planned = await prisma.plannedExpense.findFirst({
    where: { id: plannedExpenseId, householdId },
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

/** Validates an optional client-supplied recurringTemplateId actually
 * belongs to the caller's household before it's ever written to a
 * transaction. Returns `undefined` (not provided), the validated id (plus
 * its frequency, needed by assertNoDuplicateTemplatePeriod in action-helpers.ts), or an
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
      normalizeStartDay(household.budgetMonthStartDay),
    );
    if (dup) return dup;
  }

  const planned = await resolvePlannedExpenseId(household.id, parsed.data.plannedExpenseId, category.type);
  if ("error" in planned) return { error: planned.error };

  // UX-179: "Repeats" also makes a monthly recurring item from this row.
  const repeat =
    parsed.data.repeatsMonthly && !recurringTemplate.id && !planned.id
      ? repeatTemplateFields({
          description: parsed.data.description,
          categoryName: category.name,
          date: parsed.data.date,
        })
      : null;

  const transactionData = {
    householdId: household.id,
    categoryId: category.id,
    amount: parsed.data.amount,
    // Derived from the category rather than taken as a separate field, so
    // a transaction can never disagree with its own category's type.
    type: category.type,
    description: parsed.data.description || null,
    date: new Date(parsed.data.date),
    isRecurring: repeat ? true : parsed.data.isRecurring,
    recurrenceFrequency: repeat
      ? ("MONTHLY" as const)
      : parsed.data.isRecurring
        ? parsed.data.recurrenceFrequency
        : null,
    createdByUserId: userId,
    recurringTemplateId: repeat?.id ?? recurringTemplate.id ?? null,
    plannedExpenseId: planned.id ?? null,
    splits: split ? { create: split.splits } : undefined,
  };

  let created;
  try {
    if (repeat) {
      // One database transaction: the item and the row that logs it stand
      // or fall together, so a failure never leaves an item that is Due with
      // its payment already made. The template's id is chosen up front so
      // the row can point at it.
      const [, tx] = await prisma.$transaction([
        prisma.recurringTemplate.create({
          data: {
            id: repeat.id,
            householdId: household.id,
            categoryId: category.id,
            name: repeat.name,
            amount: parsed.data.amount,
            type: category.type,
            frequency: "MONTHLY",
            dayOfMonth: repeat.dayOfMonth,
            // A split bill repeats as a split bill: carry the shares.
            splits: split
              ? {
                  create: split.splits.map((s) => ({
                    householdMemberId: s.householdMemberId,
                    amountOwed: s.amountOwed,
                  })),
                }
              : undefined,
          },
          select: { id: true },
        }),
        prisma.transaction.create({ data: transactionData, select: { id: true } }),
      ]);
      created = tx;
    } else {
      created = await prisma.transaction.create({ data: transactionData, select: { id: true } });
    }
  } catch (error) {
    // Two members paying the same bill at once both pass the pre-check; the
    // unique index on plannedExpenseId rejects the loser.
    if (isUniqueViolation(error) && isPlannedExpenseTarget(error)) {
      return fail("plannedBillAlreadyPaid");
    }
    return toFriendlyError(error);
  }

  invalidateHome(household.id);
  revalidateBudgetPages();
  return { createdId: created.id };
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
    ? await prisma.householdMember.findFirst({
        where: { userId, householdId },
        include: { household: { select: { budgetMonthStartDay: true } } },
      })
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
      normalizeStartDay(member.household.budgetMonthStartDay),
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

  invalidateHome(householdId);
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
    select: { id: true, plannedExpense: { select: { category: { select: { type: true } } } } },
  });
  if (!existing) return { error: "Transaction not found" };
  // Same rule createTransactionAction enforces when the payment is logged:
  // a planned bill's payment stays an expense, received planned income stays
  // income. Moving it to another type would keep the item settled (so it
  // leaves Safe to spend's due rows) while the money lands on the other side
  // of the budget — safe to spend wrong by about twice the amount.
  const plannedType = existing.plannedExpense?.category.type;
  if (plannedType && category.type !== plannedType) {
    return fail(
      plannedItemType(plannedType) === "INCOME" ? "plannedIncomeNeedsIncomeCategory" : "plannedBillNeedsExpenseCategory",
    );
  }

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

  invalidateHome(household.id);
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

  invalidateHome(household.id);
  revalidateBudgetPages();
  return {};
}
