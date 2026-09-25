// Tests the module-private zod schemas plus every ownership (IDOR) guard in
// src/app/dashboard/personal-budget/actions.ts, indirectly through the
// exported Server Actions. Unlike the household budget, every row here is
// scoped by userId (requireUserId), not a household — the tests below
// specifically check that a category/transaction/template belonging to
// *another user* is rejected the same way an other-household resource is
// rejected in the household budget's tests. All I/O (Prisma, requireUserId,
// next/cache) is mocked — no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireUserIdMock,
  categoryFindFirstMock,
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
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
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
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalBudgetCategory: {
      findFirst: categoryFindFirstMock,
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
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createPersonalCategoryAction,
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
});
requireUserIdMock.mockResolvedValue(userId);
transactionFindManyMock.mockResolvedValue([]);

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
      data: { userId, name: "Fun money", type: "EXPENSE", monthlyLimit: null },
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
      data: { name: "Fun money", monthlyLimit: null },
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
      data: { name: "Hobbies", monthlyLimit: 750.5 },
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
  });
});
