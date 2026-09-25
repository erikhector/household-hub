// Tests the module-private zod schemas plus every IDOR guard and the
// split/recurring-template validation in
// src/app/dashboard/budget/actions.ts, indirectly through the exported
// Server Actions. All I/O (Prisma, requireHousehold, next/cache) is mocked
// — no database is touched. See REQUIREMENTS.md's "Testing" section and the
// identical convention in src/lib/actions/household.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    },
    transactionSplit: { deleteMany: vi.fn() },
    memberSettlement: { create: settlementCreateMock, deleteMany: settlementDeleteManyMock },
    householdMember: { findMany: householdMemberFindManyMock, findFirst: householdMemberFindFirstMock },
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

const {
  findOrCreateGroceriesCategory,
  createCategoryAction,
  createStarterCategoriesAction,
  updateCategoryAction,
  deleteCategoryAction,
  createTransactionAction,
  createSharedExpenseFromPersonalBudgetAction,
  updateTransactionAction,
  deleteTransactionAction,
  createRecurringTemplateAction,
  updateRecurringTemplateAction,
  setRecurringTemplateActiveAction,
  deleteRecurringTemplateAction,
  acknowledgeTemplatePeriodAction,
  unacknowledgeTemplatePeriodAction,
  logRecurringTemplateAction,
  recordSettlementAction,
  deleteSettlementAction,
} = await import("@/app/dashboard/budget/actions");

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

describe("findOrCreateGroceriesCategory", () => {
  it("returns the existing category scoped to the given household when present", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", name: "Groceries" });

    const result = await findOrCreateGroceriesCategory("household-1");

    expect(result).toEqual({ id: "cat-1", name: "Groceries" });
    expect(categoryCreateMock).not.toHaveBeenCalled();
  });

  it("creates it when missing", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({ id: "new-cat" });

    await findOrCreateGroceriesCategory("household-1");

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Groceries", type: "EXPENSE" },
    });
  });
});

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

  it("creates the category scoped to the caller's household", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    const result = await createCategoryAction({}, formData({ name: "Fun money", type: "EXPENSE" }));

    expect(result).toEqual({});
    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Fun money", type: "EXPENSE", monthlyLimit: null },
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
      data: { householdId: "household-1", name: "Dining out", type: "EXPENSE", monthlyLimit: 1500 },
    });
  });

  it("drops a monthly limit sent for an income or savings category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({});

    await createCategoryAction({}, formData({ name: "Salary", type: "INCOME", monthlyLimit: "1500" }));

    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Salary", type: "INCOME", monthlyLimit: null },
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
      data: { name: "Fun money", monthlyLimit: null },
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
      data: { name: "Food", monthlyLimit: 3000 },
    });

    categoryFindFirstMock
      .mockResolvedValueOnce({ id: "cat-2", type: "SAVINGS" })
      .mockResolvedValueOnce(null);

    await updateCategoryAction({}, formData({ id: "cat-2", name: "Buffer", monthlyLimit: "3000" }));

    expect(categoryUpdateMock).toHaveBeenLastCalledWith({
      where: { id: "cat-2" },
      data: { name: "Buffer", monthlyLimit: null },
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

  it("deletes a transaction-free category", async () => {
    categoryFindFirstMock.mockResolvedValue({
      id: "cat-1",
      _count: { transactions: 0 },
      recurringTemplates: [],
    });
    categoryDeleteMock.mockResolvedValue({});

    const result = await deleteCategoryAction("cat-1");

    expect(result).toEqual({});
    expect(categoryDeleteMock).toHaveBeenCalledWith({ where: { id: "cat-1" } });
  });
});

describe("createTransactionAction", () => {
  const base = {
    categoryId: "cat-1",
    amount: "50",
    date: "2026-01-15",
    isRecurring: "",
  };

  it("rejects a non-positive amount", async () => {
    const result = await createTransactionAction({}, formData({ ...base, amount: "0" }));
    expect(result.error).toBe("Amount must be greater than 0");
  });

  it("requires a frequency when isRecurring is checked", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });

    const result = await createTransactionAction({}, formData({ ...base, isRecurring: "on" }));

    expect(result.error).toBe("Choose how often this repeats");
  });

  it("returns 'Category not found' for a category outside the caller's household (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createTransactionAction({}, formData(base));

    expect(result.error).toBe("Category not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("derives the transaction's type from its category, never a client-supplied value", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
    transactionCreateMock.mockResolvedValue({});

    await createTransactionAction({}, formData(base));

    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "INCOME" }) }),
    );
  });

  it("rejects a recurringTemplateId that doesn't belong to the caller's household", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await createTransactionAction(
      {},
      formData({ ...base, recurringTemplateId: "someone-elses-template" }),
    );

    expect(result.error).toBe("Recurring template not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  describe("split validation (parseSplitFormData)", () => {
    // member-1 paid the whole 50 unless a test says otherwise.
    function splitFormData(
      overrides: Record<string, string> = {},
      paid: [string, string] = ["50", "0"],
    ) {
      const fd = formData({ ...base, splitEnabled: "on", ...overrides });
      fd.append("splitMemberId", "member-1");
      fd.append("splitMemberId", "member-2");
      fd.append("splitAmount", "25");
      fd.append("splitAmount", "25");
      fd.append("splitPaid", paid[0]);
      fd.append("splitPaid", paid[1]);
      return fd;
    }

    it("rejects a negative split amount", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      const fd = formData({ ...base, splitEnabled: "on" });
      fd.append("splitMemberId", "member-1");
      fd.append("splitAmount", "-5");
      fd.append("splitPaid", "0");

      const result = await createTransactionAction({}, fd);

      expect(result.error).toBe("Each split amount must be zero or more");
    });

    it("rejects a negative paid amount", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });

      const result = await createTransactionAction({}, splitFormData({}, ["-5", "0"]));

      expect(result.error).toBe("Each paid amount must be zero or more");
    });

    it("rejects misaligned split fields", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      const fd = formData({ ...base, splitEnabled: "on" });
      fd.append("splitMemberId", "member-1");
      fd.append("splitAmount", "50");

      const result = await createTransactionAction({}, fd);

      expect(result.error).toBe("Invalid split");
    });

    it("rejects when a referenced member no longer belongs to the household (IDOR guard)", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }]); // member-2 missing

      const result = await createTransactionAction({}, splitFormData());

      expect(result.error).toBe("One of the selected members no longer belongs to this household");
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects when split amounts don't sum to the transaction total", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);

      // Shares still sum to 50, not 100.
      const result = await createTransactionAction({}, splitFormData({ amount: "100" }));

      expect(result.error).toBe("The split amounts must add up to the transaction total");
    });

    it("rejects payments that add up to more than the transaction total", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);

      const result = await createTransactionAction({}, splitFormData({}, ["50", "10"]));

      expect(result.error).toBe("The paid amounts can't add up to more than the transaction total");
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("accepts split amounts within floating-point tolerance of the total", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
      transactionCreateMock.mockResolvedValue({});
      const fd = formData({ ...base, amount: "10", splitEnabled: "on" });
      fd.append("splitMemberId", "member-1");
      fd.append("splitMemberId", "member-2");
      fd.append("splitAmount", "4.995");
      fd.append("splitAmount", "5");
      fd.append("splitPaid", "10.005");
      fd.append("splitPaid", "");

      const result = await createTransactionAction({}, fd);

      expect(result).toEqual({});
    });

    it("creates the transaction with shares and payments when everything validates", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
      transactionCreateMock.mockResolvedValue({});

      await createTransactionAction({}, splitFormData());

      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          splits: {
            create: [
              { householdMemberId: "member-1", amountOwed: 25, amountPaid: 50 },
              { householdMemberId: "member-2", amountOwed: 25, amountPaid: 0 },
            ],
          },
        }),
      });
    });

    it("accepts a partly paid bill — the rest stays due", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
      transactionCreateMock.mockResolvedValue({});

      const result = await createTransactionAction({}, splitFormData({}, ["25", "0"]));

      expect(result).toEqual({});
      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          splits: {
            create: [
              { householdMemberId: "member-1", amountOwed: 25, amountPaid: 25 },
              { householdMemberId: "member-2", amountOwed: 25, amountPaid: 0 },
            ],
          },
        }),
      });
    });

    it("drops a member with no share who paid nothing", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
      transactionCreateMock.mockResolvedValue({});
      const fd = formData({ ...base, splitEnabled: "on" });
      fd.append("splitMemberId", "member-1");
      fd.append("splitMemberId", "member-2");
      fd.append("splitAmount", "50");
      fd.append("splitAmount", "0");
      fd.append("splitPaid", "50");
      fd.append("splitPaid", "0");

      await createTransactionAction({}, fd);

      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          splits: { create: [{ householdMemberId: "member-1", amountOwed: 50, amountPaid: 50 }] },
        }),
      });
    });
  });
});

describe("createSharedExpenseFromPersonalBudgetAction", () => {
  function sharedFormData(overrides: Record<string, string> = {}) {
    const fd = formData({
      householdId: "household-1",
      categoryId: "cat-1",
      amount: "50",
      date: "2026-01-15",
      isRecurring: "",
      splitEnabled: "on",
      ...overrides,
    });
    fd.append("splitMemberId", "member-1");
    fd.append("splitMemberId", "member-2");
    fd.append("splitAmount", "25");
    fd.append("splitAmount", "25");
    fd.append("splitPaid", "50");
    fd.append("splitPaid", "0");
    return fd;
  }

  it("rejects a household the caller isn't a member of (IDOR guard)", async () => {
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await createSharedExpenseFromPersonalBudgetAction({}, sharedFormData());

    expect(result.error).toBe("Choose a household you belong to");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("returns 'Category not found' for a category outside the chosen household", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createSharedExpenseFromPersonalBudgetAction({}, sharedFormData());

    expect(result.error).toBe("Category not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("requires a split — this entry point never logs an unsplit transaction", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });

    const result = await createSharedExpenseFromPersonalBudgetAction(
      {},
      sharedFormData({ splitEnabled: "" }),
    );

    expect(result.error).toBe("Choose how to split this expense");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when split amounts don't sum to the total", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);

    const result = await createSharedExpenseFromPersonalBudgetAction(
      {},
      sharedFormData({ amount: "100" }), // splits still sum to 50
    );

    expect(result.error).toBe("The split amounts must add up to the transaction total");
  });

  it("creates the household transaction with splits and revalidates both budgets", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
    transactionCreateMock.mockResolvedValue({});

    const result = await createSharedExpenseFromPersonalBudgetAction({}, sharedFormData());

    expect(result).toEqual({});
    expect(transactionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        categoryId: "cat-1",
        amount: 50,
        type: "EXPENSE",
        createdByUserId: "user-1",
        splits: {
          create: [
            { householdMemberId: "member-1", amountOwed: 25, amountPaid: 50 },
            { householdMemberId: "member-2", amountOwed: 25, amountPaid: 0 },
          ],
        },
      }),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/personal-budget");
  });

  describe("logging a payment against a shared bill (recurringTemplateId)", () => {
    beforeEach(() => {
      householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
      transactionCreateMock.mockResolvedValue({});
    });

    it("links the transaction to the template so the bill reads as logged", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue({ id: "tpl-1" });

      const result = await createSharedExpenseFromPersonalBudgetAction(
        {},
        sharedFormData({
          recurringTemplateId: "tpl-1",
          isRecurring: "on",
          recurrenceFrequency: "MONTHLY",
        }),
      );

      expect(result).toEqual({});
      expect(recurringTemplateFindFirstMock).toHaveBeenCalledWith({
        where: { id: "tpl-1", householdId: "household-1" },
        select: { id: true, frequency: true },
      });
      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          recurringTemplateId: "tpl-1",
          isRecurring: true,
          recurrenceFrequency: "MONTHLY",
        }),
      });
    });

    it("rejects a template that isn't in the chosen household (IDOR guard)", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue(null);

      const result = await createSharedExpenseFromPersonalBudgetAction(
        {},
        sharedFormData({ recurringTemplateId: "someone-elses-template" }),
      );

      expect(result.error).toBe("Recurring template not found");
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });
  });
});

describe("updateTransactionAction", () => {
  it("returns 'Transaction not found' for a transaction outside the caller's household (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionFindFirstMock.mockResolvedValue(null);

    const result = await updateTransactionAction(
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
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("deleteTransactionAction", () => {
  it("scopes the delete to the caller's household (IDOR guard)", async () => {
    transactionDeleteManyMock.mockResolvedValue({ count: 0 });

    await deleteTransactionAction("someone-elses-transaction");

    expect(transactionDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-transaction", householdId: "household-1" },
    });
  });
});

describe("recurring templates", () => {
  const templateBase = {
    name: "Rent",
    categoryId: "cat-1",
    amount: "1000",
    frequency: "MONTHLY",
  };

  it("createRecurringTemplateAction returns 'Category not found' for a category outside the household (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createRecurringTemplateAction({}, formData(templateBase));

    expect(result.error).toBe("Category not found");
    expect(recurringTemplateCreateMock).not.toHaveBeenCalled();
  });

  it("createRecurringTemplateAction derives type from the category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    recurringTemplateCreateMock.mockResolvedValue({});

    await createRecurringTemplateAction({}, formData(templateBase));

    expect(recurringTemplateCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "EXPENSE" }) }),
    );
  });

  it("updateRecurringTemplateAction returns 'Recurring template not found' for another household's template (IDOR guard)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await updateRecurringTemplateAction(
      {},
      formData({ ...templateBase, id: "someone-elses-template" }),
    );

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateUpdateMock).not.toHaveBeenCalled();
  });

  it("setRecurringTemplateActiveAction scopes the update to the caller's household", async () => {
    recurringTemplateUpdateManyMock.mockResolvedValue({ count: 0 });

    await setRecurringTemplateActiveAction("someone-elses-template", false);

    expect(recurringTemplateUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-template", householdId: "household-1" },
      data: { active: false },
    });
  });

  it("deleteRecurringTemplateAction scopes the delete to the caller's household", async () => {
    recurringTemplateDeleteManyMock.mockResolvedValue({ count: 0 });

    await deleteRecurringTemplateAction("someone-elses-template");

    expect(recurringTemplateDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-template", householdId: "household-1" },
    });
  });

  it("acknowledgeTemplatePeriodAction returns 'Recurring template not found' for another household's template", async () => {
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await acknowledgeTemplatePeriodAction("someone-elses-template");

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateAckUpsertMock).not.toHaveBeenCalled();
  });

  it("acknowledgeTemplatePeriodAction upserts idempotently for the current period", async () => {
    recurringTemplateFindFirstMock.mockResolvedValue({
      id: "template-1",
      frequency: "MONTHLY",
    });
    recurringTemplateAckUpsertMock.mockResolvedValue({});

    const result = await acknowledgeTemplatePeriodAction("template-1");

    expect(result).toEqual({});
    expect(recurringTemplateAckUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ recurringTemplateId: "template-1" }),
        update: {},
      }),
    );
  });

  it("unacknowledgeTemplatePeriodAction returns 'Recurring template not found' for another household's template", async () => {
    recurringTemplateFindFirstMock.mockResolvedValue(null);

    const result = await unacknowledgeTemplatePeriodAction("someone-elses-template");

    expect(result.error).toBe("Recurring template not found");
    expect(recurringTemplateAckDeleteManyMock).not.toHaveBeenCalled();
  });

  describe("logRecurringTemplateAction", () => {
    it("returns 'Recurring template not found' for another household's template (IDOR guard)", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue(null);

      const result = await logRecurringTemplateAction("someone-elses-template");

      expect(result.error).toBe("Recurring template not found");
      expect(transactionCreateMock).not.toHaveBeenCalled();
      expect(recurringTemplateFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "someone-elses-template", householdId: "household-1" },
        }),
      );
    });

    it("creates a transaction from the template's own fields, never a client-supplied amount/category", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue({
        id: "template-1",
        categoryId: "cat-1",
        amount: 1000,
        type: "EXPENSE",
        name: "Rent",
        frequency: "MONTHLY",
        splits: [],
      });
      transactionCreateMock.mockResolvedValue({});

      const result = await logRecurringTemplateAction("template-1");

      expect(result).toEqual({});
      expect(transactionCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          householdId: "household-1",
          categoryId: "cat-1",
          amount: 1000,
          type: "EXPENSE",
          description: "Rent",
          isRecurring: true,
          recurrenceFrequency: "MONTHLY",
          createdByUserId: "user-1",
          recurringTemplateId: "template-1",
        }),
      });
    });
  });
});

describe("settling up", () => {
  function settlementFormData(overrides: Record<string, string> = {}) {
    return formData({
      fromMemberId: "member-2",
      toMemberId: "member-1",
      amount: "3000",
      date: "2026-09-25",
      ...overrides,
    });
  }

  it("records a repayment between two members of the caller's household", async () => {
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);
    settlementCreateMock.mockResolvedValue({});

    const result = await recordSettlementAction({}, settlementFormData());

    expect(result).toEqual({});
    expect(householdMemberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["member-2", "member-1"] }, householdId: "household-1" },
      }),
    );
    expect(settlementCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        fromMemberId: "member-2",
        toMemberId: "member-1",
        amount: 3000,
        createdByUserId: "user-1",
      }),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects a member outside the household (IDOR guard)", async () => {
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }]);

    const result = await recordSettlementAction({}, settlementFormData());

    expect(result.error).toBe("One of the selected members no longer belongs to this household");
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it("rejects paying yourself", async () => {
    const result = await recordSettlementAction({}, settlementFormData({ toMemberId: "member-2" }));

    expect(result.error).toBe("Choose two different members");
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a zero amount", async () => {
    const result = await recordSettlementAction({}, settlementFormData({ amount: "0" }));

    expect(result.error).toBe("Amount must be greater than 0");
  });

  it("scopes deleting a repayment to the caller's household", async () => {
    settlementDeleteManyMock.mockResolvedValue({ count: 0 });

    await deleteSettlementAction("someone-elses-settlement");

    expect(settlementDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-settlement", householdId: "household-1" },
    });
  });
});
