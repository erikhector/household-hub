// Tests the module-private zod schemas plus every ownership (IDOR) guard in
// src/app/dashboard/personal-budget/actions.ts, indirectly through the
// exported Server Actions. Unlike the household budget, every row here is
// scoped by userId (requireUserId), not a household — the tests below
// specifically check that a category/transaction/template belonging to
// *another user* is rejected the same way an other-household resource is
// rejected in the household budget's tests. All I/O (Prisma, requireUserId,
// next/cache) is mocked — no database is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const {
  requireUserIdMock,
  categoryFindFirstMock,
  categoryFindManyMock,
  categoryCreateManyMock,
  categoryCreateMock,
  categoryUpdateMock,
  categoryDeleteMock,
  transactionFindFirstMock,
  transactionFindManyMock,
  transactionCreateMock,
  transactionUpdateMock,
  transactionDeleteManyMock,
  recurringTemplateFindFirstMock,
  recurringTemplateCreateMock,
  recurringTemplateUpdateMock,
  recurringTemplateUpdateManyMock,
  recurringTemplateDeleteManyMock,
  recurringTemplateAckUpsertMock,
  recurringTemplateAckDeleteManyMock,
  plannedExpenseFindFirstMock,
  userFindUniqueMock,
  userUpdateMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  categoryCreateManyMock: vi.fn(),
  categoryCreateMock: vi.fn(),
  categoryUpdateMock: vi.fn(),
  categoryDeleteMock: vi.fn(),
  transactionFindFirstMock: vi.fn(),
  transactionFindManyMock: vi.fn(),
  transactionCreateMock: vi.fn(),
  transactionUpdateMock: vi.fn(),
  transactionDeleteManyMock: vi.fn(),
  recurringTemplateFindFirstMock: vi.fn(),
  recurringTemplateCreateMock: vi.fn(),
  recurringTemplateUpdateMock: vi.fn(),
  recurringTemplateUpdateManyMock: vi.fn(),
  recurringTemplateDeleteManyMock: vi.fn(),
  recurringTemplateAckUpsertMock: vi.fn(),
  recurringTemplateAckDeleteManyMock: vi.fn(),
  plannedExpenseFindFirstMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  userUpdateMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalBudgetCategory: {
      findFirst: categoryFindFirstMock,
      findMany: categoryFindManyMock,
      createMany: categoryCreateManyMock,
      create: categoryCreateMock,
      update: categoryUpdateMock,
      delete: categoryDeleteMock,
    },
    personalTransaction: {
      findFirst: transactionFindFirstMock,
      findMany: transactionFindManyMock,
      create: transactionCreateMock,
      update: transactionUpdateMock,
      deleteMany: transactionDeleteManyMock,
    },
    personalRecurringTemplate: {
      findFirst: recurringTemplateFindFirstMock,
      create: recurringTemplateCreateMock,
      update: recurringTemplateUpdateMock,
      updateMany: recurringTemplateUpdateManyMock,
      deleteMany: recurringTemplateDeleteManyMock,
    },
    personalRecurringTemplateAck: {
      upsert: recurringTemplateAckUpsertMock,
      deleteMany: recurringTemplateAckDeleteManyMock,
    },
    personalPlannedExpense: { findFirst: plannedExpenseFindFirstMock },
    // The user's Personal Budget month start day (getPersonalBudgetStartDay).
    user: { findUnique: userFindUniqueMock, update: userUpdateMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
// fail() (src/lib/actions/errors.ts) reads the request's dictionary. With no
// request here, `{}` makes it fall back to English (see budget/actions.test.ts).
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: vi.fn(async () => ({})), getLocale: vi.fn(async () => "en") }));

const {
  createPersonalCategoryAction,
  createPersonalStarterCategoriesAction,
  updatePersonalCategoryAction,
  deletePersonalCategoryAction,
  createPersonalTransactionAction,
  updatePersonalTransactionAction,
  deletePersonalTransactionAction,
  createPersonalRecurringTemplateAction,
  updatePersonalRecurringTemplateAction,
  setPersonalRecurringTemplateActiveAction,
  deletePersonalRecurringTemplateAction,
  acknowledgePersonalTemplatePeriodAction,
  unacknowledgePersonalTemplatePeriodAction,
  logPersonalRecurringTemplateAction,
  setPersonalBudgetMonthStartDayAction,
} = await import("@/app/dashboard/personal-budget/actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const userId = "user-1";

afterEach(() => {
  vi.clearAllMocks();
  requireUserIdMock.mockResolvedValue(userId);
  transactionFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ personalBudgetMonthStartDay: 1 });
});
requireUserIdMock.mockResolvedValue(userId);
transactionFindManyMock.mockResolvedValue([]);
userFindUniqueMock.mockResolvedValue({ personalBudgetMonthStartDay: 1 });

describe("createPersonalStarterCategoriesAction", () => {
  it("rejects an empty item list", async () => {
    const result = await createPersonalStarterCategoriesAction([]);
    expect(result.error).toBeTruthy();
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid type", async () => {
    const result = await createPersonalStarterCategoriesAction([
      { name: "Salary", type: "BOGUS" as never },
    ]);
    expect(result.error).toBeTruthy();
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });

  it("scopes the batch create (and the existing-name lookup) to the caller's own userId", async () => {
    categoryFindManyMock.mockResolvedValue([]);
    categoryCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await createPersonalStarterCategoriesAction([
      { name: "Salary", type: "INCOME" },
      { name: "Eating out", type: "EXPENSE" },
    ]);

    expect(result).toEqual({ added: 2 });
    expect(categoryFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId } }));
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [
        { userId, name: "Salary", type: "INCOME" },
        { userId, name: "Eating out", type: "EXPENSE" },
      ],
    });
  });

  it("skips categories the user already has (case-insensitive) and repeats within the batch", async () => {
    categoryFindManyMock.mockResolvedValue([{ name: "salary" }]);
    categoryCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await createPersonalStarterCategoriesAction([
      { name: "Salary", type: "INCOME" },
      { name: "Clothes", type: "EXPENSE" },
      { name: "clothes", type: "EXPENSE" },
    ]);

    expect(result).toEqual({ added: 1 });
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [{ userId, name: "Clothes", type: "EXPENSE" }],
    });
  });

  it("returns added: 0 without calling createMany when everything already exists", async () => {
    categoryFindManyMock.mockResolvedValue([{ name: "Salary" }]);

    const result = await createPersonalStarterCategoriesAction([{ name: "Salary", type: "INCOME" }]);

    expect(result).toEqual({ added: 0 });
    expect(categoryCreateManyMock).not.toHaveBeenCalled();
  });
});

describe("createPersonalCategoryAction", () => {
  it("rejects a duplicate name for this user (case-insensitive)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "existing" });

    const result = await createPersonalCategoryAction({}, formData({ name: "groceries", type: "EXPENSE" }));

    expect(result.error).toBe("A category with that name already exists");
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  it("scopes the created category to the caller's own userId", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createPersonalCategoryAction({}, formData({ name: "Fun money", type: "EXPENSE" }));

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { userId, name: "Fun money", type: "EXPENSE", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
    expect(categoryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId }) }),
    );
  });
});

describe("updatePersonalCategoryAction", () => {
  it("returns 'Category not found' for another user's category (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await updatePersonalCategoryAction(
      {},
      formData({ id: "someone-elses-category", name: "Renamed" }),
    );

    expect(result.error).toBe("Category not found");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name for this user (case-insensitive), excluding itself", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1" })
      .mockResolvedValueOnce({ id: "cat-2" });

    const result = await updatePersonalCategoryAction({}, formData({ id: "cat-1", name: "Groceries" }));

    expect(result.error).toBe("A category with that name already exists");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  it("renames the category scoped to the caller's own userId", async () => {
    categoryFindFirstMock.mockResolvedValueOnce({ id: "cat-1" }).mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    const result = await updatePersonalCategoryAction({}, formData({ id: "cat-1", name: "Fun money" }));

    expect(result).toEqual({});
    expect(categoryUpdateMock).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { name: "Fun money", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  // GAP-12: same monthly-limit handling as the household budget's
  // updateCategoryAction.
  it("stores a monthly limit on an expense category", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    await updatePersonalCategoryAction(
      {},
      formData({ id: "cat-1", name: "Hobbies", monthlyLimit: "750.5" }),
    );

    expect(categoryUpdateMock).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { name: "Hobbies", monthlyLimit: 750.5, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  // GAP-21: same rollover handling as the household budget's actions.
  it("stores rollover alongside a limit and drops it without one", async () => {
    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});

    await updatePersonalCategoryAction(
      {},
      formData({ id: "cat-1", name: "Hobbies", monthlyLimit: "750", rolloverEnabled: "on" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: { name: "Hobbies", monthlyLimit: 750, rolloverEnabled: true, goalAmount: null, goalDate: null },
    });

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    await updatePersonalCategoryAction(
      {},
      formData({ id: "cat-1", name: "Hobbies", rolloverEnabled: "on" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: { name: "Hobbies", monthlyLimit: null, rolloverEnabled: false, goalAmount: null, goalDate: null },
    });
  });

  it("creates a rollover category scoped to the caller's own userId", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createPersonalCategoryAction(
      {},
      formData({ name: "Clothes", type: "EXPENSE", monthlyLimit: "400", rolloverEnabled: "on" }),
    );

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { userId, name: "Clothes", type: "EXPENSE", monthlyLimit: 400, rolloverEnabled: true, goalAmount: null, goalDate: null },
    });
  });

  it("rejects a monthly limit that isn't a number", async () => {
    const result = await updatePersonalCategoryAction(
      {},
      formData({ id: "cat-1", name: "Hobbies", monthlyLimit: "lots" }),
    );

    expect(result.error).toBe("Monthly limit must be a number");
    expect(categoryUpdateMock).not.toHaveBeenCalled();
  });

  // GAP-22: same savings-goal handling as the household budget's actions.
  it("stores a savings goal on a savings category and drops it on any other", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createPersonalCategoryAction(
      {},
      formData({ name: "New bike", type: "SAVINGS", goalAmount: "8000", goalDate: "2027-03-15" }),
    );
    expect(categoryCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        userId,
        type: "SAVINGS",
        goalAmount: 8000,
        goalDate: new Date(Date.UTC(2027, 2, 15)),
      }),
    });

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-1", type: "EXPENSE" })
      .mockResolvedValueOnce(null);
    categoryUpdateMock.mockResolvedValue({});
    await updatePersonalCategoryAction(
      {},
      formData({ id: "cat-1", name: "Hobbies", goalAmount: "8000", goalDate: "2027-03-15" }),
    );
    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-1" },
      data: expect.objectContaining({ goalAmount: null, goalDate: null }),
    });
  });
});

describe("deletePersonalCategoryAction", () => {
  it("returns 'Category not found' for another user's category (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await deletePersonalCategoryAction("someone-elses-category");

    expect(result.error).toBe("Category not found");
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses to delete a category that has transactions", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", _count: { transactions: 1 } });

    const result = await deletePersonalCategoryAction("cat-1");

    expect(result.error).toBe("This category has transactions and can't be deleted");
  });

  it("names the planned bill that still uses the category", async () => {
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      _count: { transactions: 0 },
      recurringTemplates: [],
      plannedExpenses: [{ name: "Dentist" }],
    });

    const result = await deletePersonalCategoryAction("cat-1");

    expect(result.error).toBe('This category is used by the planned bill "Dentist" — remove or reassign it first');
    expect(categoryDeleteMock).not.toHaveBeenCalled();
  });
});

describe("createPersonalTransactionAction", () => {
  const base = { categoryId: "cat-1", amount: "50", date: "2026-01-15", isRecurring: "" };

  it("returns 'Category not found' for another user's category (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createPersonalTransactionAction({}, formData(base));

    expect(result.error).toBe("Category not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("requires a frequency when isRecurring is checked", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });

    const result = await createPersonalTransactionAction({}, formData({ ...base, isRecurring: "on" }));

    expect(result.error).toBe("Choose how often this repeats");
  });

  it("rejects a recurringTemplateId that doesn't belong to the caller", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await createPersonalTransactionAction(
      {},
      formData({ ...base, recurringTemplateId: "someone-elses-template" }),
    );

    expect(result.error).toBe("Recurring template not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("derives type from the category and scopes the transaction to the caller", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
    transactionCreateMock.mockResolvedValue({});

    await createPersonalTransactionAction({}, formData(base));

    expect(transactionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId, type: "INCOME" }),
      select: { id: true },
    });
  });

  it("returns the new row's id so the saved toast can undo exactly it (UX-109)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionCreateMock.mockResolvedValue({ id: "new-tx" });

    const result = await createPersonalTransactionAction({}, formData(base));

    expect(result).toEqual({ createdId: "new-tx" });
  });

  describe("planned bill link", () => {
    beforeEach(() => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      transactionCreateMock.mockResolvedValue({ id: "new-tx" });
    });

    it("links the transaction to the caller's own planned bill", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ createdId: "new-tx" });
      expect(plannedExpenseFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "p1", userId } }),
      );
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: "p1" }) }),
      );
    });

    it("rejects another user's planned bill (IDOR guard)", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue(null);

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "Planned bill not found" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects an already paid planned bill", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: { id: "t9" } });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("maps a unique-constraint race to the already-paid error", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });
      transactionCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: {
            driverAdapterError: {
              cause: {
                kind: "UniqueConstraintViolation",
                constraint: { index: "PersonalTransaction_plannedExpenseId_key" },
              },
            },
          },
        }),
      );

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
    });

    it("rejects paying a planned bill from a non-expense category", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "SAVINGS" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "A planned bill can only be paid from an expense category" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("links received income to the caller's planned income", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: null });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ createdId: "new-tx" });
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: "p1", type: "INCOME" }) }),
      );
    });

    it("rejects logging planned income in an expense category", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: null });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "Planned income can only be logged in an income category" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects planned income that's already received", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: { id: "t9" } });

      const result = await createPersonalTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned income is already received" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("without plannedExpenseId never looks up a bill", async () => {
      await createPersonalTransactionAction({}, formData(base));

      expect(plannedExpenseFindFirstMock).not.toHaveBeenCalled();
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: null }) }),
      );
    });
  });
});

describe("updatePersonalTransactionAction", () => {
  it("returns 'Transaction not found' for another user's transaction (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionFindFirstMock.mockResolvedValue(null);

    const result = await updatePersonalTransactionAction(
      {},
      formData({
        id: "someone-elses-transaction",
        categoryId: "cat-1",
        amount: "10",
        date: "2026-01-01",
        isRecurring: "",
      }),
    );

    expect(result.error).toBe("Transaction not found");
    expect(transactionUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps a planned bill's payment in an expense category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-2", type: "INCOME" });
    transactionFindFirstMock.mockResolvedValue({ id: "t1", plannedExpense: { category: { type: "EXPENSE" } } });

    const result = await updatePersonalTransactionAction(
      {},
      formData({ id: "t1", categoryId: "cat-2", amount: "10", date: "2026-01-01", isRecurring: "" }),
    );

    expect(result).toEqual({ error: "A planned bill can only be paid from an expense category" });
    expect(transactionUpdateMock).not.toHaveBeenCalled();
  });

  it("keeps received planned income in an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionFindFirstMock.mockResolvedValue({ id: "t1", plannedExpense: { category: { type: "INCOME" } } });

    const result = await updatePersonalTransactionAction(
      {},
      formData({ id: "t1", categoryId: "cat-1", amount: "10", date: "2026-01-01", isRecurring: "" }),
    );

    expect(result).toEqual({ error: "Planned income can only be logged in an income category" });
    expect(transactionUpdateMock).not.toHaveBeenCalled();
  });

  it("still lets a planned bill's payment be edited within an expense category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionFindFirstMock.mockResolvedValue({ id: "t1", plannedExpense: { category: { type: "EXPENSE" } } });
    transactionUpdateMock.mockResolvedValue({});

    const result = await updatePersonalTransactionAction(
      {},
      formData({ id: "t1", categoryId: "cat-1", amount: "1100", date: "2026-01-01", isRecurring: "" }),
    );

    expect(result).toEqual({});
    expect(transactionUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: expect.objectContaining({ amount: 1100 }) }),
    );
  });
});

describe("deletePersonalTransactionAction", () => {
  it("scopes the delete to the caller's own userId", async () => {
    transactionDeleteManyMock.mockResolvedValue({ count: 0 });

    await deletePersonalTransactionAction("someone-elses-transaction");

    expect(transactionDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-transaction", userId },
    });
  });
});

describe("personal recurring templates", () => {
  const templateBase = { name: "Gym", categoryId: "cat-1", amount: "300", frequency: "MONTHLY" };

  it("createPersonalRecurringTemplateAction returns 'Category not found' for another user's category (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createPersonalRecurringTemplateAction({}, formData(templateBase));

    expect(result.error).toBe("Category not found");
    expect(recurringTemplateCreateMock).not.toHaveBeenCalled();
  });

  it("updatePersonalRecurringTemplateAction returns 'Recurring template not found' for another user's template (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await updatePersonalRecurringTemplateAction(
      {},
      formData({ ...templateBase, id: "someone-elses-template" }),
    );

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateUpdateMock).not.toHaveBeenCalled();
  });

  it("setPersonalRecurringTemplateActiveAction scopes the update to the caller's own userId", async () => {
    recurringTemplateUpdateManyMock.mockResolvedValue({ count: 0 });

    await setPersonalRecurringTemplateActiveAction("someone-elses-template", false);

    expect(recurringTemplateUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-template", userId },
      data: { active: false },
    });
  });

  it("deletePersonalRecurringTemplateAction scopes the delete to the caller's own userId", async () => {
    recurringTemplateDeleteManyMock.mockResolvedValue({ count: 0 });

    await deletePersonalRecurringTemplateAction("someone-elses-template");

    expect(recurringTemplateDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-template", userId },
    });
  });

  it("acknowledgePersonalTemplatePeriodAction returns 'Recurring template not found' for another user's template", async () => {
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await acknowledgePersonalTemplatePeriodAction("someone-elses-template");

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateAckUpsertMock).not.toHaveBeenCalled();
  });

  it("unacknowledgePersonalTemplatePeriodAction returns 'Recurring template not found' for another user's template", async () => {
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await unacknowledgePersonalTemplatePeriodAction("someone-elses-template");

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateAckDeleteManyMock).not.toHaveBeenCalled();
  });

  describe("logPersonalRecurringTemplateAction", () => {
    it("returns 'Recurring template not found' for another user's template (IDOR guard)", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue(null);

      const result = await logPersonalRecurringTemplateAction("someone-elses-template");

      expect(result.error).toBe("Recurring template not found");
      expect(transactionCreateMock).not.toHaveBeenCalled();
      expect(recurringTemplateFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "someone-elses-template", userId } }),
      );
    });

    it("creates a transaction from the template's own fields, never a client-supplied amount/category", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue({
        id: "template-1",
        categoryId: "cat-1",
        amount: 300,
        type: "EXPENSE",
        name: "Gym",
        frequency: "MONTHLY",
      });
      transactionCreateMock.mockResolvedValue({});

      const result = await logPersonalRecurringTemplateAction("template-1");

      expect(result).toEqual({});
      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          categoryId: "cat-1",
          amount: 300,
          type: "EXPENSE",
          description: "Gym",
          isRecurring: true,
          recurrenceFrequency: "MONTHLY",
          recurringTemplateId: "template-1",
        }),
      });
    });

    it("only reads the current period's transactions, however many periods the template spans (PERF-17)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(2026, 8, 30, 12));
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 300, type: "EXPENSE", name: "Gym", frequency: "MONTHLY" });
        // The DB filter bounds the read; what comes back is one August row
        // at most, which must not block a September log.
        transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 7, 31) }]);
        transactionCreateMock.mockResolvedValue({});

        const result = await logPersonalRecurringTemplateAction("template-1");

        expect(result).toEqual({});
        expect(transactionFindManyMock).toHaveBeenCalledWith({
          where: {
            recurringTemplateId: "template-1",
            date: { gte: new Date(2026, 8, 1), lt: new Date(2026, 9, 1) },
          },
          select: { date: true },
        });
        expect(transactionCreateMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects a second log when a row already sits in the current period", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(2026, 8, 30, 12));
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 300, type: "EXPENSE", name: "Gym", frequency: "MONTHLY" });
        transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 8, 3) }]);

        const result = await logPersonalRecurringTemplateAction("template-1");

        expect(result.error).toBe(
          "A transaction for this recurring item already exists for this period",
        );
        expect(transactionCreateMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("guards the user's own payday period when their start day is 25", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        // 26 Sep with day 25 is in "October" (25 Sep to 24 Oct), so a row
        // logged on 3 Sep (September's period) doesn't block it.
        vi.setSystemTime(new Date(2026, 8, 26, 12));
        userFindUniqueMock.mockResolvedValue({ personalBudgetMonthStartDay: 25 });
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 300, type: "EXPENSE", name: "Gym", frequency: "MONTHLY" });
        transactionFindManyMock.mockResolvedValue([]);
        transactionCreateMock.mockResolvedValue({});

        const result = await logPersonalRecurringTemplateAction("template-1");

        expect(result).toEqual({});
        expect(userFindUniqueMock).toHaveBeenCalledWith({
          where: { id: userId },
          select: { personalBudgetMonthStartDay: true },
        });
        expect(transactionFindManyMock).toHaveBeenCalledWith({
          where: {
            recurringTemplateId: "template-1",
            date: { gte: new Date(2026, 8, 25), lt: new Date(2026, 9, 25) },
          },
          select: { date: true },
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("acknowledgePersonalTemplatePeriodAction marks the user's payday period, named for the month it ends in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 8, 26, 12));
      userFindUniqueMock.mockResolvedValue({ personalBudgetMonthStartDay: 25 });
      recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", frequency: "MONTHLY" });
      recurringTemplateAckUpsertMock.mockResolvedValue({});

      const result = await acknowledgePersonalTemplatePeriodAction("template-1");

      expect(result).toEqual({});
      expect(recurringTemplateAckUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ create: { personalRecurringTemplateId: "template-1", periodKey: "2026-10" } }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("setPersonalBudgetMonthStartDayAction", () => {
  it("saves the day on the session's own user", async () => {
    userUpdateMock.mockResolvedValue({});

    const result = await setPersonalBudgetMonthStartDayAction(25);

    expect(result).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: userId },
      data: { personalBudgetMonthStartDay: 25 },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/personal-budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it.each([0, 29, 12.5, Number.NaN])("rejects %s, outside 1 to 28", async (day) => {
    const result = await setPersonalBudgetMonthStartDayAction(day);

    expect(result.error).toBe("Choose a day from 1 to 28");
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});
