// Tests the personal planned-bill Server Actions (planned-expense-actions.ts):
// input validation and the ownership (IDOR) guards — category and bill id are
// both scoped by the signed-in user. All I/O is mocked — no database is
// touched. Same convention as actions.test.ts in this folder.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserIdMock,
  categoryFindFirstMock,
  plannedCreateMock,
  plannedUpdateManyMock,
  plannedDeleteManyMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireUserIdMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
  plannedCreateMock: vi.fn(),
  plannedUpdateManyMock: vi.fn(),
  plannedDeleteManyMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    personalBudgetCategory: { findFirst: categoryFindFirstMock },
    personalPlannedExpense: {
      create: plannedCreateMock,
      updateMany: plannedUpdateManyMock,
      deleteMany: plannedDeleteManyMock,
    },
  },
}));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
// fail() falls back to English with an empty dictionary.
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: vi.fn(async () => ({})), getLocale: vi.fn(async () => "en") }));

import {
  createPersonalPlannedExpenseAction,
  deletePersonalPlannedExpenseAction,
  updatePersonalPlannedExpenseAction,
} from "./planned-expense-actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const userId = "u1";
const valid = { name: "Dentist", amount: "1200", categoryId: "c1", dueDate: "2026-11-20" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserIdMock.mockResolvedValue(userId);
  categoryFindFirstMock.mockResolvedValue({ id: "c1" });
  plannedCreateMock.mockResolvedValue({ id: "p1" });
  plannedUpdateManyMock.mockResolvedValue({ count: 1 });
  plannedDeleteManyMock.mockResolvedValue({ count: 1 });
});

describe("createPersonalPlannedExpenseAction", () => {
  it("scopes the category to the caller's own expense and income categories", async () => {
    await createPersonalPlannedExpenseAction({}, form(valid));

    expect(requireUserIdMock).toHaveBeenCalled();
    expect(categoryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", userId, type: { in: ["EXPENSE", "INCOME"] } } }),
    );
  });

  it("creates the bill for the caller with the due date at UTC noon", async () => {
    const result = await createPersonalPlannedExpenseAction({}, form(valid));

    expect(result).toEqual({});
    expect(plannedCreateMock).toHaveBeenCalledWith({
      data: {
        userId,
        name: "Dentist",
        amount: 1200,
        categoryId: "c1",
        dueDate: new Date("2026-11-20T12:00:00Z"),
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/personal-budget");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects another user's (or a savings) category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await createPersonalPlannedExpenseAction({}, form(valid));

    expect(result).toEqual({ error: "Category not found" });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an impossible due date", async () => {
    const result = await createPersonalPlannedExpenseAction({}, form({ ...valid, dueDate: "2026-02-31" }));

    expect(result).toEqual({ error: "Invalid due date" });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a zero amount and an empty name", async () => {
    expect(await createPersonalPlannedExpenseAction({}, form({ ...valid, amount: "0" }))).toEqual({
      error: "Amount must be greater than zero",
    });
    expect(await createPersonalPlannedExpenseAction({}, form({ ...valid, name: "  " }))).toEqual({
      error: "Name is required",
    });
    expect(plannedCreateMock).not.toHaveBeenCalled();
  });
});

describe("updatePersonalPlannedExpenseAction", () => {
  it("updates only the caller's own bill", async () => {
    const result = await updatePersonalPlannedExpenseAction({}, form({ ...valid, id: "p1" }));

    expect(result).toEqual({});
    expect(plannedUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "p1", userId },
      data: expect.objectContaining({ name: "Dentist", amount: 1200, categoryId: "c1" }),
    });
  });

  it("returns not found for another user's bill (IDOR guard)", async () => {
    plannedUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await updatePersonalPlannedExpenseAction({}, form({ ...valid, id: "someone-elses" }));

    expect(result).toEqual({ error: "Planned bill not found" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("returns not found without an id", async () => {
    const result = await updatePersonalPlannedExpenseAction({}, form(valid));

    expect(result).toEqual({ error: "Planned bill not found" });
    expect(plannedUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects a category that isn't the caller's expense category", async () => {
    categoryFindFirstMock.mockResolvedValue(null);

    const result = await updatePersonalPlannedExpenseAction({}, form({ ...valid, id: "p1" }));

    expect(result).toEqual({ error: "Category not found" });
    expect(plannedUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("deletePersonalPlannedExpenseAction", () => {
  it("scopes the delete to the caller", async () => {
    const result = await deletePersonalPlannedExpenseAction("p1");

    expect(result).toEqual({});
    expect(plannedDeleteManyMock).toHaveBeenCalledWith({ where: { id: "p1", userId } });
  });

  it("returns not found for another user's bill", async () => {
    plannedDeleteManyMock.mockResolvedValue({ count: 0 });

    const result = await deletePersonalPlannedExpenseAction("someone-elses");

    expect(result).toEqual({ error: "Planned bill not found" });
  });

  it("refuses a missing id instead of deleting every bill of the user's", async () => {
    const result = await deletePersonalPlannedExpenseAction(undefined as unknown as string);

    expect(result).toEqual({ error: "Planned bill not found" });
    expect(plannedDeleteManyMock).not.toHaveBeenCalled();
  });
});
