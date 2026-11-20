// Tests the module-private zod schemas plus every IDOR guard and the
// split/recurring-template validation in
// src/app/dashboard/budget/transaction-actions.ts, indirectly through the exported
// Server Actions. All I/O (Prisma, requireHousehold, next/cache) is mocked
// — no database is touched. See REQUIREMENTS.md's "Testing" section and the
// identical convention in src/lib/actions/household.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
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
  createTransactionAction,
  createSharedExpenseFromPersonalBudgetAction,
  updateTransactionAction,
  deleteTransactionAction,
} = await import("@/app/dashboard/budget/transaction-actions");

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


describe("createTransactionAction", () => {
  const base = {
    categoryId: "cat-1",
    amount: "50",
    date: "2026-01-15",
    isRecurring: "",
  };

  describe("Repeats switch (UX-179)", () => {
    beforeEach(() => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", name: "Rent", type: "EXPENSE" });
      recurringTemplateCreateMock.mockResolvedValue({ id: "tpl" });
      transactionCreateMock.mockResolvedValue({ id: "new-tx" });
    });

    it("creates a monthly item in the caller's household and logs this row against it, in one database transaction", async () => {
      const result = await createTransactionAction(
        {},
        formData({ ...base, repeatsMonthly: "on", description: "Gym" }),
      );

      expect(result).toEqual({ createdId: "new-tx" });
      expect(transactionMock).toHaveBeenCalledTimes(1);
      const tplData = recurringTemplateCreateMock.mock.calls[0][0].data;
      expect(tplData).toMatchObject({
        householdId: household.id,
        categoryId: "cat-1",
        name: "Gym",
        amount: 50,
        type: "EXPENSE",
        frequency: "MONTHLY",
        dayOfMonth: 15,
      });
      expect(transactionCreateMock.mock.calls[0][0].data).toMatchObject({
        householdId: household.id,
        recurringTemplateId: tplData.id,
        isRecurring: true,
        recurrenceFrequency: "MONTHLY",
      });
    });

    it("names the item after the category when there is no description", async () => {
      await createTransactionAction({}, formData({ ...base, repeatsMonthly: "on" }));

      expect(recurringTemplateCreateMock.mock.calls[0][0].data.name).toBe("Rent");
    });

    it("carries a split's shares onto the item", async () => {
      householdMemberFindManyMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

      // FormData.set keeps one value per key, so append the repeated inputs.
      const fd = formData({ ...base, repeatsMonthly: "on", splitEnabled: "on" });
      fd.append("splitMemberId", "m1");
      fd.append("splitMemberId", "m2");
      fd.append("splitAmount", "30");
      fd.append("splitAmount", "20");
      fd.append("splitPaid", "50");
      fd.append("splitPaid", "0");
      await createTransactionAction({}, fd);

      expect(recurringTemplateCreateMock.mock.calls[0][0].data.splits).toEqual({
        create: [
          { householdMemberId: "m1", amountOwed: 30 },
          { householdMemberId: "m2", amountOwed: 20 },
        ],
      });
    });

    it("creates no item without the switch", async () => {
      await createTransactionAction({}, formData(base));

      expect(recurringTemplateCreateMock).not.toHaveBeenCalled();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("creates no item for a payment logged against an existing recurring item", async () => {
      recurringTemplateFindFirstMock.mockResolvedValue({ id: "tpl-1", frequency: "MONTHLY" });

      await createTransactionAction(
        {},
        formData({ ...base, repeatsMonthly: "on", recurringTemplateId: "tpl-1" }),
      );

      expect(recurringTemplateCreateMock).not.toHaveBeenCalled();
    });

    it("creates nothing for a category outside the caller's household (IDOR guard)", async () => {
      categoryFindFirstMock.mockResolvedValue(null);

      const result = await createTransactionAction({}, formData({ ...base, repeatsMonthly: "on" }));

      expect(result.error).toBe("Category not found");
      expect(categoryFindFirstMock).toHaveBeenCalledWith({
        where: { id: "cat-1", householdId: household.id },
      });
      expect(recurringTemplateCreateMock).not.toHaveBeenCalled();
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });
  });

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

  it("returns the new row's id so the saved toast can undo exactly it (UX-109)", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    transactionCreateMock.mockResolvedValue({ id: "new-tx" });

    const result = await createTransactionAction({}, formData(base));

    expect(result).toEqual({ createdId: "new-tx" });
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

  describe("planned bill link (BUDGET-8)", () => {
    beforeEach(() => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
      transactionCreateMock.mockResolvedValue({});
    });

    it("links the transaction to a planned bill", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({});
      expect(plannedExpenseFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "p1", householdId: household.id } }),
      );
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: "p1" }) }),
      );
    });

    it("rejects a planned bill from another household", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue(null);

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "Planned bill not found" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects an already paid planned bill", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: { id: "t9" } });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("maps a unique-constraint race to the already-paid error (pg adapter, constraint index)", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });
      transactionCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index: "Transaction_plannedExpenseId_key" } } } },
        }),
      );

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
    });

    it("maps the race when the adapter reports constraint fields", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });
      transactionCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { fields: ["plannedExpenseId"] } } } },
        }),
      );

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
    });

    it("maps the race from the meta.target fallback", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });
      transactionCreateMock.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
          meta: { target: ["plannedExpenseId"] },
        }),
      );

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned bill is already paid" });
    });

    it("rejects paying a planned bill from a non-expense category", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "A planned bill can only be paid from an expense category" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("links received income to planned income", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: null });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result.error).toBeUndefined();
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: "p1", type: "INCOME" }) }),
      );
    });

    it("rejects logging planned income in an expense category", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: null });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "Planned income can only be logged in an income category" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("rejects planned income that's already received", async () => {
      categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "INCOME" });
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: { id: "t9" } });

      const result = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));

      expect(result).toEqual({ error: "This planned income is already received" });
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });

    it("returns the planned bill errors in the user's language", async () => {
      plannedExpenseFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: { id: "t9" } });
      getDictionaryMock.mockResolvedValueOnce(sv);
      const paid = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));
      expect(paid).toEqual({ error: sv.errors.plannedBillAlreadyPaid });

      plannedExpenseFindFirstMock.mockResolvedValue(null);
      getDictionaryMock.mockResolvedValueOnce(sv);
      const missing = await createTransactionAction({}, formData({ ...base, plannedExpenseId: "p1" }));
      expect(missing).toEqual({ error: sv.errors.plannedBillNotFound });
    });

    it("without plannedExpenseId nothing changes", async () => {
      await createTransactionAction({}, formData(base));

      expect(plannedExpenseFindFirstMock).not.toHaveBeenCalled();
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plannedExpenseId: null }) }),
      );
    });
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
        select: { id: true },
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
        select: { id: true },
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
        select: { id: true },
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
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1", household: { budgetMonthStartDay: 1 } });
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createSharedExpenseFromPersonalBudgetAction({}, sharedFormData());

    expect(result.error).toBe("Category not found");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("requires a split — this entry point never logs an unsplit transaction", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1", household: { budgetMonthStartDay: 1 } });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });

    const result = await createSharedExpenseFromPersonalBudgetAction(
      {},
      sharedFormData({ splitEnabled: "" }),
    );

    expect(result.error).toBe("Choose how to split this expense");
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when split amounts don't sum to the total", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1", household: { budgetMonthStartDay: 1 } });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    householdMemberFindManyMock.mockResolvedValue([{ id: "member-1" }, { id: "member-2" }]);

    const result = await createSharedExpenseFromPersonalBudgetAction(
      {},
      sharedFormData({ amount: "100" }), // splits still sum to 50
    );

    expect(result.error).toBe("The split amounts must add up to the transaction total");
  });

  it("creates the household transaction with splits and revalidates both budgets", async () => {
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1", household: { budgetMonthStartDay: 1 } });
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
      householdMemberFindFirstMock.mockResolvedValue({ id: "member-1", household: { budgetMonthStartDay: 1 } });
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

  it("rejects moving a planned bill's payment to an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-salary", type: "INCOME" });
    transactionFindFirstMock.mockResolvedValue({ id: "tx-1", plannedExpense: { category: { type: "EXPENSE" } } });

    const result = await updateTransactionAction(
      {},
      formData({ id: "tx-1", categoryId: "cat-salary", amount: "3000", date: "2026-10-20", isRecurring: "" }),
    );

    expect(result.error).toBe("A planned bill can only be paid from an expense category");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("keeps received planned income in an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-food", type: "EXPENSE" });
    transactionFindFirstMock.mockResolvedValue({ id: "tx-1", plannedExpense: { category: { type: "INCOME" } } });

    const result = await updateTransactionAction(
      {},
      formData({ id: "tx-1", categoryId: "cat-food", amount: "3000", date: "2026-10-20", isRecurring: "" }),
    );

    expect(result.error).toBe("Planned income can only be logged in an income category");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("still lets an ordinary transaction move to an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-salary", type: "INCOME" });
    transactionFindFirstMock.mockResolvedValue({ id: "tx-1", plannedExpense: null });

    const result = await updateTransactionAction(
      {},
      formData({ id: "tx-1", categoryId: "cat-salary", amount: "3000", date: "2026-10-20", isRecurring: "" }),
    );

    expect(result).toEqual({});
    expect(transactionMock).toHaveBeenCalled();
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
