"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold, requireUserId } from "@/lib/session";
import { getPeriodKey } from "@/lib/recurring-template-calc";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

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
  type: z.enum(["INCOME", "EXPENSE", "SAVINGS"]),
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

  try {
    await prisma.budgetCategory.create({
      data: { householdId: household.id, name: parsed.data.name, type: parsed.data.type },
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
});

export async function updateCategoryAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = updateCategorySchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
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

  try {
    await prisma.budgetCategory.update({
      where: { id: category.id },
      data: { name: parsed.data.name },
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
    include: { _count: { select: { transactions: true } } },
  });
  if (!category) return { error: "Category not found" };
  if (category._count.transactions > 0) {
    return { error: "This category has transactions and can't be deleted" };
  }

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

/** Validates an optional client-supplied recurringTemplateId actually
 * belongs to the caller's household before it's ever written to a
 * transaction. Returns `undefined` (not provided), the validated id, or an
 * error. */
async function resolveRecurringTemplateId(
  householdId: string,
  recurringTemplateId: string | undefined,
): Promise<{ error: string } | { id: string | undefined }> {
  if (!recurringTemplateId) return { id: undefined };
  const template = await prisma.recurringTemplate.findFirst({
    where: { id: recurringTemplateId, householdId },
    select: { id: true },
  });
  if (!template) return { error: "Recurring template not found" };
  return { id: template.id };
}

// Amounts within this tolerance of the transaction total are accepted —
// guards against floating point noise (e.g. splitting 10 three ways), not a
// real mismatch.
const SPLIT_SUM_TOLERANCE = 0.01;

/**
 * Parses the optional "split this expense" section of the transaction form
 * — same repeated-input convention as the meal-planning ingredient rows
 * (`formData.getAll`, aligned by index). Returns `null` when splitting
 * wasn't requested (the "splitEnabled" checkbox was off), so a plain
 * transaction is completely unaffected.
 *
 * Validates every referenced member actually belongs to the caller's
 * household (never trusts a client-supplied id beyond that check) and that
 * the split amounts sum to the transaction's total amount.
 */
async function parseSplitFormData(
  formData: FormData,
  householdId: string,
  amount: number,
): Promise<
  | { error: string }
  | { paidByMemberId: string; splits: { householdMemberId: string; amountOwed: number }[] } | null
> {
  if (formData.get("splitEnabled") !== "on") return null;

  const paidByMemberId = String(formData.get("paidByMemberId") || "");
  if (!paidByMemberId) return { error: "Choose who paid" };

  const memberIds = formData.getAll("splitMemberId").map((v) => String(v));
  const amounts = formData.getAll("splitAmount").map((v) => Number(v));
  if (memberIds.length === 0 || memberIds.length !== amounts.length) {
    return { error: "Invalid split" };
  }
  if (amounts.some((a) => Number.isNaN(a) || a < 0)) {
    return { error: "Each split amount must be zero or more" };
  }

  const allMemberIds = [...new Set([paidByMemberId, ...memberIds])];
  const validMembers = await prisma.householdMember.findMany({
    where: { id: { in: allMemberIds }, householdId },
    select: { id: true },
  });
  if (validMembers.length !== allMemberIds.length) {
    return { error: "One of the selected members no longer belongs to this household" };
  }

  const splitTotal = amounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(splitTotal - amount) > SPLIT_SUM_TOLERANCE) {
    return { error: "The split amounts must add up to the transaction total" };
  }

  return {
    paidByMemberId,
    splits: memberIds.map((householdMemberId, i) => ({ householdMemberId, amountOwed: amounts[i] })),
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
        paidByMemberId: split?.paidByMemberId ?? null,
        recurringTemplateId: recurringTemplate.id ?? null,
        splits: split
          ? {
              create: split.splits.map((s) => ({
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

/**
 * Logs a shared household expense from Personal Budget's "Log a shared
 * expense" dialog (LogSharedExpenseDialog) — the entry-point half of
 * PERSONAL_HOUSEHOLD_BUDGET_LINK.md's read-only surfacing (wave A/B/C
 * already covers "shared costs show up in my personal budget"; this covers
 * "let me register one from my personal budget").
 *
 * This creates exactly the same kind of `Transaction` + `TransactionSplit`
 * rows `createTransactionAction` does — the household budget stays the one
 * ledger of record, per PERSONAL_HOUSEHOLD_BUDGET_LINK.md §2 ("two ledgers,
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
        paidByMemberId: split.paidByMemberId,
        recurringTemplateId: recurringTemplate.id ?? null,
        splits: {
          create: split.splits.map((s) => ({
            householdMemberId: s.householdMemberId,
            amountOwed: s.amountOwed,
          })),
        },
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard/personal-budget");
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
          paidByMemberId: split?.paidByMemberId ?? null,
          splits: split
            ? {
                create: split.splits.map((s) => ({
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

export async function deleteTransactionAction(transactionId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.transaction.deleteMany({
      where: { id: transactionId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
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

/**
 * Parses the optional "split this bill" section of the recurring-template
 * form (RecurringTemplateDialog) — same repeated-input convention and
 * validation as parseSplitFormData above, minus a "paid by" member: a
 * template is never itself "paid", only its expected shares matter (see
 * prisma/schema.prisma's RecurringTemplateSplit doc comment). Returns `null`
 * when splitting wasn't requested, so a plain template is completely
 * unaffected — no retroactive backfill for existing templates either way.
 */
async function parseTemplateSplitFormData(
  formData: FormData,
  householdId: string,
  amount: number,
): Promise<{ error: string } | { householdMemberId: string; amountOwed: number }[] | null> {
  if (formData.get("splitEnabled") !== "on") return null;

  const memberIds = formData.getAll("splitMemberId").map((v) => String(v));
  const amounts = formData.getAll("splitAmount").map((v) => Number(v));
  if (memberIds.length === 0 || memberIds.length !== amounts.length) {
    return { error: "Invalid split" };
  }
  if (amounts.some((a) => Number.isNaN(a) || a < 0)) {
    return { error: "Each split amount must be zero or more" };
  }

  const validMembers = await prisma.householdMember.findMany({
    where: { id: { in: memberIds }, householdId },
    select: { id: true },
  });
  if (validMembers.length !== new Set(memberIds).size) {
    return { error: "One of the selected members no longer belongs to this household" };
  }

  const splitTotal = amounts.reduce((sum, a) => sum + a, 0);
  if (Math.abs(splitTotal - amount) > SPLIT_SUM_TOLERANCE) {
    return { error: "The split amounts must add up to the template's amount" };
  }

  return memberIds.map((householdMemberId, i) => ({ householdMemberId, amountOwed: amounts[i] }));
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

  const split = await parseTemplateSplitFormData(formData, household.id, parsed.data.amount);
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

  const split = await parseTemplateSplitFormData(formData, household.id, parsed.data.amount);
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
 * means a repeat click just no-ops against the existing row.
 */
export async function acknowledgeTemplatePeriodAction(templateId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
  });
  if (!template) return { error: "Recurring template not found" };

  const periodKey = getPeriodKey(new Date(), template.frequency);
  try {
    await prisma.recurringTemplateAck.upsert({
      where: { recurringTemplateId_periodKey: { recurringTemplateId: template.id, periodKey } },
      create: { recurringTemplateId: template.id, periodKey },
      update: {},
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
  return {};
}

/**
 * One-click "log it as-is" — creates a Transaction straight from the
 * template's own amount/category/frequency (today's date, no dialog, no
 * client-supplied amount/category trusted) for the common case where the
 * amount doesn't need adjusting this period. This produces the same shape
 * of row `createTransactionAction` would when called from
 * `TransactionDialog`'s `prefillFromTemplate` path — including the
 * `recurringTemplateId` link — so `computeTemplateStatuses` (which derives
 * "posted" purely from a matching transaction's `recurringTemplateId` +
 * period, not from a RecurringTemplateAck row) sees the period as fulfilled
 * without any separate acknowledgement step.
 */
export async function logRecurringTemplateAction(templateId: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const template = await prisma.recurringTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
  });
  if (!template) return { error: "Recurring template not found" };

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
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/budget");
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
