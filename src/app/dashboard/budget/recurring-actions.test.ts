// Tests the module-private zod schemas plus every IDOR guard and the
// split/recurring-template validation in
// src/app/dashboard/budget/recurring-actions.ts, indirectly through the exported
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
  createRecurringTemplateAction,
  updateRecurringTemplateAction,
  setRecurringTemplateActiveAction,
  deleteRecurringTemplateAction,
  acknowledgeTemplatePeriodAction,
  unacknowledgeTemplatePeriodAction,
  logRecurringTemplateAction,
} = await import("@/app/dashboard/budget/recurring-actions");

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

    it("only reads the current period's transactions, however many periods the template spans (PERF-17)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(2026, 8, 30, 12));
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 1000, type: "EXPENSE", name: "Rent", frequency: "MONTHLY", splits: [] });
        // The DB filter bounds the read; what comes back is one August row
        // at most, which must not block a September log.
        transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 7, 31) }]);
        transactionCreateMock.mockResolvedValue({});

        const result = await logRecurringTemplateAction("template-1");

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
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 1000, type: "EXPENSE", name: "Rent", frequency: "MONTHLY", splits: [] });
        transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 8, 3) }]);

        const result = await logRecurringTemplateAction("template-1");

        expect(result.error).toBe(
          "A transaction for this recurring item already exists for this period",
        );
        expect(transactionCreateMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    // UX-134: with the budget month starting on the 25th, 28 September and 1
    // October are one period, so October's rent paid early counts as logged.
    describe("with a budget month starting on the 25th (UX-134)", () => {
      beforeEach(() => {
        requireHouseholdMock.mockResolvedValue({
          household: { id: "household-1", budgetMonthStartDay: 25 },
          userId: "user-1",
        });
        recurringTemplateFindFirstMock.mockResolvedValue({ id: "template-1", categoryId: "cat-1", amount: 12500, type: "EXPENSE", name: "Rent", frequency: "MONTHLY", splits: [] });
      });

      it("reads the 25th-to-24th period and rejects a second log in it", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date(2026, 8, 30, 12));
          transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 8, 28) }]);

          const result = await logRecurringTemplateAction("template-1");

          expect(transactionFindManyMock).toHaveBeenCalledWith(
            expect.objectContaining({
              where: {
                recurringTemplateId: "template-1",
                date: { gte: new Date(2026, 8, 25), lt: new Date(2026, 9, 25) },
              },
            }),
          );
          expect(result.error).toBe(
            "A transaction for this recurring item already exists for this period",
          );
          expect(transactionCreateMock).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("does not count the previous period's log", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date(2026, 8, 30, 12));
          // 3 September is in the period that ended on 24 September.
          transactionFindManyMock.mockResolvedValue([{ date: new Date(2026, 8, 3) }]);
          transactionCreateMock.mockResolvedValue({});

          const result = await logRecurringTemplateAction("template-1");

          expect(result).toEqual({});
          expect(transactionCreateMock).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });

      it("acknowledges under the period's key, named for the month it ends in", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date(2026, 8, 30, 12));
          recurringTemplateAckUpsertMock.mockResolvedValue({});

          await acknowledgeTemplatePeriodAction("template-1");

          expect(recurringTemplateAckUpsertMock).toHaveBeenCalledWith(
            expect.objectContaining({
              create: expect.objectContaining({ periodKey: "2026-10" }),
            }),
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
