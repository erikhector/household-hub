// Tests the module-private zod schemas plus every IDOR guard and the
// split/recurring-template validation in
// src/app/dashboard/budget/category-actions.ts, indirectly through the exported
// Server Actions. All I/O (Prisma, requireHousehold, next/cache) is mocked
// — no database is touched. See REQUIREMENTS.md's "Testing" section and the
// identical convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { sv } from "@/lib/i18n/dictionaries/sv";

const {
  requireHouseholdMock,
  requireUserIdMock,
  categoryFindFirstMock,
  categoryFindManyMock,
  categoryCreateMock,
  categoryCreateManyMock,
  categoryUpdateMock,
  categoryDeleteMock,
  transactionFindFirstMock,
  transactionFindManyMock,
  transactionCreateMock,
  transactionDeleteManyMock,
  transactionMock,
  householdMemberFindManyMock,
  householdMemberFindFirstMock,
  plannedExpenseFindFirstMock,
  recurringTemplateFindFirstMock,
  recurringTemplateCreateMock,
  recurringTemplateUpdateMock,
  recurringTemplateUpdateManyMock,
  recurringTemplateDeleteManyMock,
  recurringTemplateAckUpsertMock,
  recurringTemplateAckDeleteManyMock,
  settlementCreateMock,
  settlementDeleteManyMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  requireUserIdMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  categoryCreateMock: vi.fn(),
  categoryCreateManyMock: vi.fn(),
  categoryUpdateMock: vi.fn(),
  categoryDeleteMock: vi.fn(),
  transactionFindFirstMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
  transactionCreateMock: vi.fn(),
  transactionDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  householdMemberFindManyMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  plannedExpenseFindFirstMock: vi.fn(),
  recurringTemplateFindFirstMock: vi.fn(),
  recurringTemplateCreateMock: vi.fn(),
  recurringTemplateUpdateMock: vi.fn(),
  recurringTemplateUpdateManyMock: vi.fn(),
  recurringTemplateDeleteManyMock: vi.fn(),
  recurringTemplateAckUpsertMock: vi.fn(),
  recurringTemplateAckDeleteManyMock: vi.fn(),
  settlementCreateMock: vi.fn(),
  settlementDeleteManyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetCategory: {
      findFirst: categoryFindFirstMock,
      findMany: categoryFindManyMock,
      create: categoryCreateMock,
      createMany: categoryCreateManyMock,
      update: categoryUpdateMock,
      delete: categoryDeleteMock,
    },
    transaction: {
      findFirst: transactionFindFirstMock,
      findMany: transactionFindManyMock,
      create: transactionCreateMock,
      deleteMany: transactionDeleteManyMock,
      update: vi.fn(),
    },
    transactionSplit: { deleteMany: vi.fn() },
    memberSettlement: { create: settlementCreateMock, deleteMany: settlementDeleteManyMock },
    householdMember: { findMany: householdMemberFindManyMock, findFirst: householdMemberFindFirstMock },
    plannedExpense: { findFirst: plannedExpenseFindFirstMock },
    recurringTemplate: {
      findFirst: recurringTemplateFindFirstMock,
      create: recurringTemplateCreateMock,
      update: recurringTemplateUpdateMock,
      updateMany: recurringTemplateUpdateManyMock,
      deleteMany: recurringTemplateDeleteManyMock,
    },
    recurringTemplateAck: {
      upsert: recurringTemplateAckUpsertMock,
      deleteMany: recurringTemplateAckDeleteManyMock,
    },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({
  requireHousehold: requireHouseholdMock,
  requireUserId: requireUserIdMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
// fail() (src/lib/actions/errors.ts) reads the request's dictionary. With no
// request here, the default `{}` makes it fall back to English; a test that
// checks a translated error swaps in `sv` for one call.
const { getDictionaryMock } = vi.hoisted(() => ({ getDictionaryMock: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock, getLocale: vi.fn(async () => "en") }));

const {
  createCategoryAction,
  createStarterCategoriesAction,
  updateCategoryAction,
  deleteCategoryAction,
} = await import("@/app/dashboard/budget/category-actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  requireUserIdMock.mockResolvedValue("user-1");
  transactionFindManyMock.mockResolvedValue([]);
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
requireUserIdMock.mockResolvedValue("user-1");
transactionFindManyMock.mockResolvedValue([]);


describe("createCategoryAction", () => {
  it("rejects an empty name", async () => {
    const result = await createCategoryAction({}, formData({ name: " ", type: "EXPENSE" }));
    expect(result.error).toBe("Name is required");
  });

  it("rejects a duplicate name within the household (case-insensitive)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "existing" });

    const result = await createCategoryAction({}, formData({ name: "groceries", type: "EXPENSE" }));

    expect(result.error).toBe("A category with that name already exists");
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  // MAINT-7: the errors, the shared limit and goal fields' included, are in
  // the request's language.
  it("answers in Swedish for a Swedish user", async () => {
    getDictionaryMock.mockResolvedValueOnce(sv);
    const blank = await createCategoryAction({}, formData({ name: " ", type: "EXPENSE" }));
    expect(blank.error).toBe(sv.errors.nameRequired);

    getDictionaryMock.mockResolvedValueOnce(sv);
    const zeroLimit = await createCategoryAction(
      {},
      formData({ name: "Dining out", type: "EXPENSE", monthlyLimit: "0" }),
    );
    expect(zeroLimit.error).toBe(sv.errors.monthlyLimitPositive);

    getDictionaryMock.mockResolvedValueOnce(sv);
    const badDate = await createCategoryAction(
      {},
      formData({ name: "Trip", type: "SAVINGS", goalAmount: "1000", goalDate: "soon" }),
    );
    expect(badDate.error).toBe(sv.errors.goalDateInvalid);

    categoryFindFirstMock.mockResolvedValue({ id: "existing" });
    getDictionaryMock.mockResolvedValueOnce(sv);
    const taken = await createCategoryAction({}, formData({ name: "groceries", type: "EXPENSE" }));
    expect(taken.error).toBe(sv.errors.categoryNameTaken);
    expect(taken.error).not.toBe("A category with that name already exists");
  });

  it("creates the category scoped to the caller's household", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    const result = await createCategoryAction({}, formData({ name: "Fun money", type: "EXPENSE" }));

    expect(result).toEqual({});
    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Fun money", type: "EXPENSE", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  // GAP-12: optional monthly spending cap.
  it("stores a monthly limit on an expense category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction(
      {},
      formData({ name: "Dining out", type: "EXPENSE", monthlyLimit: "1500" }),
    );

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Dining out", type: "EXPENSE", monthlyLimit: 1500, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  it("drops a monthly limit sent for an income or savings category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction({}, formData({ name: "Salary", type: "INCOME", monthlyLimit: "1500" }));

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Salary", type: "INCOME", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  // GAP-21: rollover is kept only alongside a limit.
  it("stores rollover on an expense category that has a limit", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction(
      {},
      formData({ name: "Dining out", type: "EXPENSE", monthlyLimit: "1500", rolloverEnabled: "on" }),
    );

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "Dining out",
        type: "EXPENSE",
        monthlyLimit: 1500,
        rolloverEnabled: true,
        goalAmount: null,
        goalDate: null,
      },
    });
  });

  it("drops rollover when there's no limit to carry, or the type can't have one", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction(
      {},
      formData({ name: "Dining out", type: "EXPENSE", rolloverEnabled: "on" }),
    );
    expect(categoryCreateMock).toHaveBeenLastCalledWith({
      data: {
        householdId: "household-1",
        name: "Dining out",
        type: "EXPENSE",
        monthlyLimit: null,
        rolloverEnabled: false,
        goalAmount: null,
        goalDate: null,
      },
    });

    await createCategoryAction(
      {},
      formData({ name: "Buffer", type: "SAVINGS", monthlyLimit: "500", rolloverEnabled: "on" }),
    );
    expect(categoryCreateMock).toHaveBeenLastCalledWith({
      data: {
        householdId: "household-1",
        name: "Buffer",
        type: "SAVINGS",
        monthlyLimit: null,
        rolloverEnabled: false,
        goalAmount: null,
        goalDate: null,
      },
    });
  });

  it("rejects a monthly limit that isn't positive", async () => {
    const result = await createCategoryAction(
      {},
      formData({ name: "Dining out", type: "EXPENSE", monthlyLimit: "0" }),
    );

    expect(result.error).toBe("Monthly limit must be greater than 0");
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  // GAP-22: an optional savings goal, kept only on SAVINGS categories.
  it("stores a savings goal and date on a savings category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction(
      {},
      formData({ name: "Holiday", type: "SAVINGS", goalAmount: "20000", goalDate: "2027-06-01" }),
    );

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "Holiday",
        type: "SAVINGS",
        monthlyLimit: null,
        rolloverEnabled: false,
        goalAmount: 20000,
        goalDate: new Date(Date.UTC(2027, 5, 1)),
      },
    });
  });

  it("drops a goal sent for a non-savings category, and a date sent without an amount", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction(
      {},
      formData({ name: "Food", type: "EXPENSE", goalAmount: "20000", goalDate: "2027-06-01" }),
    );
    expect(categoryCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ type: "EXPENSE", goalAmount: null, goalDate: null }),
    });

    await createCategoryAction({}, formData({ name: "Buffer", type: "SAVINGS", goalDate: "2027-06-01" }));
    expect(categoryCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ type: "SAVINGS", goalAmount: null, goalDate: null }),
    });
  });

  it("rejects an invalid goal amount or date", async () => {
    const zero = await createCategoryAction({}, formData({ name: "Holiday", type: "SAVINGS", goalAmount: "0" }));
    expect(zero.error).toBe("Savings goal must be greater than 0");

    const badDate = await createCategoryAction(
      {},
      formData({ name: "Holiday", type: "SAVINGS", goalAmount: "100", goalDate: "2027-02-30" }),
    );
    expect(badDate.error).toBe("Goal date must be a valid date");
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });
});

describe("createStarterCategoriesAction", () => {
  it("rejects an empty item list", async () => {
    const result = await createStarterCategoriesAction([]);
    expect(result.error).toBeTruthy();
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid type", async () => {
    const result = await createStarterCategoriesAction([
      { name: "Groceries", type: "BOGUS" as never },
    ]);
    expect(result.error).toBeTruthy();
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });

  it("scopes the batch create to the caller's household", async () => {
    categoryFindManyMock.mockResolvedValue([]);
    categoryCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await createStarterCategoriesAction([
      { name: "Groceries", type: "EXPENSE" },
      { name: "Salary", type: "INCOME" },
    ]);

    expect(result).toEqual({ added: 2 });
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [
        { householdId: "household-1", name: "Groceries", type: "EXPENSE" },
        { householdId: "household-1", name: "Salary", type: "INCOME" },
      ],
    });
  });

  it("skips categories that already exist (case-insensitive)", async () => {
    categoryFindManyMock.mockResolvedValue([{ name: "groceries" }]);
    categoryCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await createStarterCategoriesAction([
      { name: "Groceries", type: "EXPENSE" },
      { name: "Rent", type: "EXPENSE" },
    ]);

    expect(result).toEqual({ added: 1 });
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [{ householdId: "household-1", name: "Rent", type: "EXPENSE" }],
    });
  });

  it("dedupes repeats within the same batch, keeping the first occurrence", async () => {
    categoryFindManyMock.mockResolvedValue([]);
    categoryCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await createStarterCategoriesAction([
      { name: "Rent", type: "EXPENSE" },
      { name: "rent", type: "INCOME" },
    ]);

    expect(result).toEqual({ added: 1 });
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [{ householdId: "household-1", name: "Rent", type: "EXPENSE" }],
    });
  });

  it("returns added: 0 without calling createMany when everything already exists", async () => {
    categoryFindManyMock.mockResolvedValue([{ name: "Groceries" }]);

    const result = await createStarterCategoriesAction([{ name: "Groceries", type: "EXPENSE" }]);

    expect(result).toEqual({ added: 0 });
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });
});

describe("updateCategoryAction", () => {
  it("rejects an empty name", async () => {
    const result = await updateCategoryAction({}, formData({ id: "cat-1", name: " " }));
    expect(result.error).toBe("Name is required");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 'Category not found' for a category outside the caller's household (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await updateCategoryAction(
      {},
      formData({ id: "someone-elses-category", name: "Renamed" }),
    );

    expect(result.error).toBe("Category not found");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name within the household (case-insensitive), excluding itself", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1" })
      .mockResolvedValueOnce({ id: "cat-2" });

    const result = await updateCategoryAction({}, formData({ id: "cat-1", name: "Groceries" }));

    expect(result.error).toBe("A category with that name already exists");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it("renames the category scoped to the caller's household", async () => {
    categoryFindFirstMock.mockResolvedValueOnce({ id: "cat-1" }).mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    const result = await updateCategoryAction({}, formData({ id: "cat-1", name: "Fun money" }));

    expect(result).toEqual({});
    expect(categoryUpdateMock).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { name: "Fun money", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  it("sets or clears the monthly limit based on the stored category's type", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    await updateCategoryAction({}, formData({ id: "cat-1", name: "Food", monthlyLimit: "3000" }));

    expect(categoryUpdateMock).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { name: "Food", monthlyLimit: 3000, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-2", type: "SAVINGS" })
      .mockResolvedValueOnce(null);

    await updateCategoryAction({}, formData({ id: "cat-2", name: "Buffer", monthlyLimit: "3000" }));

    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-2" },
      data: { name: "Buffer", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  it("turns rollover on or off with the edit form, clearing it with the limit", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    await updateCategoryAction(
      {},
      formData({ id: "cat-1", name: "Food", monthlyLimit: "3000", rolloverEnabled: "on" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: { name: "Food", monthlyLimit: 3000, rolloverEnabled: true, goalAmount: null, goalDate: null },
    });

    // An unticked checkbox isn't posted at all — that's "off".
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    await updateCategoryAction({}, formData({ id: "cat-1", name: "Food", monthlyLimit: "3000" }));
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: { name: "Food", monthlyLimit: 3000, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });

    // Clearing the limit clears rollover even if the flag is still sent.
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    await updateCategoryAction(
      {},
      formData({ id: "cat-1", name: "Food", monthlyLimit: "", rolloverEnabled: "on" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: { name: "Food", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  // GAP-22: the goal is kept or cleared by the *stored* type, so an expense
  // category can't gain one by posting the fields.
  it("sets, changes or clears a savings goal based on the stored category's type", async () => {
    categoryUpdateMock.mockResolvedValue({});

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-2", type: "SAVINGS" })
      .mockResolvedValueOnce(null);
    await updateCategoryAction(
      {},
      formData({ id: "cat-2", name: "Holiday", goalAmount: "15000", goalDate: "2026-12-31" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-2" },
      data: {
        name: "Holiday",
        monthlyLimit: null,
        rolloverEnabled: false,
        goalAmount: 15000,
        goalDate: new Date(Date.UTC(2026, 11, 31)),
      },
    });

    // Emptying the amount clears the goal, date included.
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-2", type: "SAVINGS" })
      .mockResolvedValueOnce(null);
    await updateCategoryAction(
      {},
      formData({ id: "cat-2", name: "Holiday", goalAmount: "", goalDate: "2026-12-31" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-2" },
      data: expect.objectContaining({ goalAmount: null, goalDate: null }),
    });

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    await updateCategoryAction(
      {},
      formData({ id: "cat-1", name: "Food", goalAmount: "15000", goalDate: "2026-12-31" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: expect.objectContaining({ goalAmount: null, goalDate: null }),
    });
  });
});

describe("deleteCategoryAction", () => {
  it("returns 'Category not found' for a category outside the caller's household (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await deleteCategoryAction("someone-elses-category");

    expect(result.error).toBe("Category not found");
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses to delete a category that has transactions", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", _count: { transactions: 3 } });

    const result = await deleteCategoryAction("cat-1");

    expect(result.error).toBe("This category has transactions and can't be deleted");
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });

  it("says a category isn't found in the user's language", async () => {
    getDictionaryMock.mockResolvedValueOnce(sv);
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await deleteCategoryAction("someone-elses-category");

    expect(result.error).toBe(sv.errors.categoryNotFound);
  });

  it("names the planned bill that still uses the category instead of failing generically", async () => {
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      _count: { transactions: 0 },
      recurringTemplates: [],
      plannedExpenses: [{ name: "Car insurance" }],
    });

    const result = await deleteCategoryAction("cat-1");

    expect(result.error).toBe('This category is used by the planned bill "Car insurance" — remove or reassign it first');
    expect(categoryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ plannedExpenses: { select: { name: true }, take: 1 } }),
      }),
    );
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });

  it("names planned income that still uses an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      type: "INCOME",
      _count: { transactions: 0 },
      recurringTemplates: [],
      plannedExpenses: [{ name: "Tax refund" }],
    });

    const result = await deleteCategoryAction("cat-1");

    expect(result.error).toBe('This category is used by the planned income "Tax refund" — remove or reassign it first');
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });

  it("names the planned bill in the user's language", async () => {
    getDictionaryMock.mockResolvedValueOnce(sv);
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      _count: { transactions: 0 },
      recurringTemplates: [],
      plannedExpenses: [{ name: "Bilförsäkring" }],
    });

    const result = await deleteCategoryAction("cat-1");

    expect(result.error).toBe(
      'Kategorin används av den planerade räkningen "Bilförsäkring" – ta bort den eller byt kategori först',
    );
  });

  it("deletes a transaction-free category", async () => {
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      _count: { transactions: 0 },
      recurringTemplates: [],
      plannedExpenses: [],
    });
    categoryDeleteMock.mockResolvedValue({});

    const result = await deleteCategoryAction("cat-1");

    expect(result).toEqual({});
    expect(categoryDeleteMock).toHaveBeenCalledWith({ where: { id: "cat-1" } });
  });
});
