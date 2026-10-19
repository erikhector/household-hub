// Tests the planned-bill Server Actions (planned-expense-actions.ts): input
// validation, IDOR guards (category, members, bill id all scoped by
// household) and split handling. All I/O is mocked — no database is touched.
// Same convention as actions.test.ts in this folder.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  categoryFindFirstMock,
  memberFindManyMock,
  plannedCreateMock,
  plannedFindFirstMock,
  plannedUpdateMock,
  plannedDeleteManyMock,
  splitDeleteManyMock,
  transactionMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  plannedCreateMock: vi.fn(),
  plannedFindFirstMock: vi.fn(),
  plannedUpdateMock: vi.fn(),
  plannedDeleteManyMock: vi.fn(),
  splitDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetCategory: { findFirst: categoryFindFirstMock },
    householdMember: { findMany: memberFindManyMock },
    plannedExpense: {
      create: plannedCreateMock,
      findFirst: plannedFindFirstMock,
      update: plannedUpdateMock,
      deleteMany: plannedDeleteManyMock,
    },
    plannedExpenseSplit: { deleteMany: splitDeleteManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  createPlannedExpenseAction,
  deletePlannedExpenseAction,
  updatePlannedExpenseAction,
} from "./planned-expense-actions";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const valid = { name: "Insurance", amount: "3000", categoryId: "c1", dueDate: "2026-10-31" };

beforeEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "h1" }, userId: "u1" });
  categoryFindFirstMock.mockResolvedValue({ id: "c1", type: "EXPENSE" });
  memberFindManyMock.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
  plannedCreateMock.mockResolvedValue({ id: "p1" });
  plannedFindFirstMock.mockResolvedValue({ id: "p1" });
  plannedUpdateMock.mockResolvedValue({ id: "p1" });
  plannedDeleteManyMock.mockResolvedValue({ count: 1 });
  splitDeleteManyMock.mockResolvedValue({ count: 0 });
});

describe("createPlannedExpenseAction", () => {
  it("calls requireHousehold and scopes the category to the household's expense and income categories", async () => {
    await createPlannedExpenseAction({}, form(valid));
    expect(requireHouseholdMock).toHaveBeenCalled();
    expect(categoryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", householdId: "h1", type: { in: ["EXPENSE", "INCOME"] } },
      }),
    );
  });

  it("creates planned income in an income category", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "c1", type: "INCOME" });
    const result = await createPlannedExpenseAction({}, form({ ...valid, name: "Tax refund" }));
    expect(result).toEqual({});
    expect(plannedCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ categoryId: "c1", name: "Tax refund", splits: undefined }),
    });
  });

  it("refuses to split planned income", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "c1", type: "INCOME" });
    const result = await createPlannedExpenseAction(
      {},
      form({ ...valid, splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["1500", "1500"] }),
    );
    expect(result).toEqual({ error: "Planned income can't be split" });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing name", { ...valid, name: "  " }],
    ["a zero amount", { ...valid, amount: "0" }],
    ["a negative amount", { ...valid, amount: "-5" }],
    ["a bad date", { ...valid, dueDate: "31/10/2026" }],
  ])("rejects %s", async (_label, fields) => {
    const result = await createPlannedExpenseAction({}, form(fields));
    expect(result.error).toBeTruthy();
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a category from another household or a savings category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);
    const result = await createPlannedExpenseAction({}, form(valid));
    expect(result).toEqual({ error: "Category not found" });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a member from another household", async () => {
    memberFindManyMock.mockResolvedValue([{ id: "m1" }]);
    const result = await createPlannedExpenseAction(
      {},
      form({ ...valid, splitEnabled: "on", splitMemberId: ["m1", "mX"], splitAmount: ["1500", "1500"] }),
    );
    expect(result.error).toBeTruthy();
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("rejects shares that don't add up", async () => {
    const result = await createPlannedExpenseAction(
      {},
      form({ ...valid, splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["1000", "1000"] }),
    );
    expect(result).toEqual({ error: "The split amounts must add up to the bill's amount" });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("parses dueDate as UTC noon", async () => {
    await createPlannedExpenseAction({}, form({ ...valid, dueDate: "2026-10-31" }));
    expect(plannedCreateMock.mock.calls[0][0].data.dueDate).toEqual(new Date("2026-10-31T12:00:00Z"));
  });

  it("creates the bill with its splits and revalidates the budget pages", async () => {
    const result = await createPlannedExpenseAction(
      {},
      form({ ...valid, splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["1500", "1500"] }),
    );
    expect(result).toEqual({});
    expect(plannedCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "h1",
        createdByUserId: "u1",
        categoryId: "c1",
        name: "Insurance",
        amount: 3000,
        splits: {
          create: [
            { householdMemberId: "m1", amountOwed: 1500 },
            { householdMemberId: "m2", amountOwed: 1500 },
          ],
        },
      }),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/personal-budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });
});

describe("updatePlannedExpenseAction", () => {
  it("scopes by household and replaces splits in one $transaction", async () => {
    const result = await updatePlannedExpenseAction(
      {},
      form({ ...valid, id: "p1", splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["1500", "1500"] }),
    );
    expect(result).toEqual({});
    expect(plannedFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1", householdId: "h1" } }),
    );
    expect(splitDeleteManyMock).toHaveBeenCalledWith({ where: { plannedExpenseId: "p1" } });
    expect(plannedUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" } }),
    );
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(transactionMock.mock.calls[0][0]).toHaveLength(2);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/personal-budget");
  });

  it("refuses to split planned income", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "c1", type: "INCOME" });
    const result = await updatePlannedExpenseAction(
      {},
      form({ ...valid, id: "p1", splitEnabled: "on", splitMemberId: ["m1", "m2"], splitAmount: ["1500", "1500"] }),
    );
    expect(result).toEqual({ error: "Planned income can't be split" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses to move a paid bill to an income category", async () => {
    plannedFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: { id: "t1" } });
    categoryFindFirstMock.mockResolvedValue({ id: "c2", type: "INCOME" });
    const result = await updatePlannedExpenseAction({}, form({ ...valid, id: "p1", categoryId: "c2" }));
    expect(result).toEqual({
      error: "A paid bill or received income can't move between expense and income categories",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses to move received income to an expense category", async () => {
    plannedFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "INCOME" }, transaction: { id: "t1" } });
    const result = await updatePlannedExpenseAction({}, form({ ...valid, id: "p1" }));
    expect(result).toEqual({
      error: "A paid bill or received income can't move between expense and income categories",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("still edits a paid bill within its own type, and moves an unpaid one across", async () => {
    plannedFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: { id: "t1" } });
    expect(await updatePlannedExpenseAction({}, form({ ...valid, id: "p1" }))).toEqual({});

    plannedFindFirstMock.mockResolvedValue({ id: "p1", category: { type: "EXPENSE" }, transaction: null });
    categoryFindFirstMock.mockResolvedValue({ id: "c2", type: "INCOME" });
    expect(await updatePlannedExpenseAction({}, form({ ...valid, id: "p1", categoryId: "c2" }))).toEqual({});
  });

  it("rejects a bill from another household", async () => {
    plannedFindFirstMock.mockResolvedValue(null);
    const result = await updatePlannedExpenseAction({}, form({ ...valid, id: "foreign" }));
    expect(result).toEqual({ error: "Planned bill not found" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("deletePlannedExpenseAction", () => {
  it("is scoped by household", async () => {
    const result = await deletePlannedExpenseAction("p1");
    expect(result).toEqual({});
    expect(plannedDeleteManyMock).toHaveBeenCalledWith({ where: { id: "p1", householdId: "h1" } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/budget");
  });

  it("reports a bill that isn't the household's", async () => {
    plannedDeleteManyMock.mockResolvedValue({ count: 0 });
    expect(await deletePlannedExpenseAction("foreign")).toEqual({ error: "Planned bill not found" });
  });
});
