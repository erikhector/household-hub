// Tests the module-private zod schemas plus every IDOR guard and the
// split/recurring-template validation in
// src/app/dashboard/budget/settlement-actions.ts, indirectly through the exported
// Server Actions. All I/O (Prisma, requireHousehold, next/cache) is mocked
// — no database is touched. See REQUIREMENTS.md's "Testing" section and the
// identical convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

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
  recordSettlementAction,
  deleteSettlementAction,
} = await import("@/app/dashboard/budget/settlement-actions");

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
