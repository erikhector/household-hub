import { afterEach, describe, expect, it, vi } from "vitest";

const { householdFindUniqueMock, householdUpdateMock, categoryFindFirstMock, categoryCreateMock } = vi.hoisted(() => ({
  householdFindUniqueMock: vi.fn(),
  householdUpdateMock: vi.fn(),
  categoryFindFirstMock: vi.fn(),
  categoryCreateMock: vi.fn(),
}));

// The resolver runs on the caller's transaction client, so the "tx" here is
// just a plain object of mocks — no @/lib/prisma import to stub.
const tx = {
  household: { findUnique: householdFindUniqueMock, update: householdUpdateMock },
  budgetCategory: { findFirst: categoryFindFirstMock, create: categoryCreateMock },
} as never;

const { resolveShoppingExpenseCategory } = await import("@/lib/budget-groceries-category");

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveShoppingExpenseCategory", () => {
  it("uses the household's picked expense category without touching Groceries", async () => {
    const picked = { id: "cat-food", name: "Mat", type: "EXPENSE", householdId: "household-1" };
    householdFindUniqueMock.mockResolvedValue({ shoppingExpenseCategory: picked });

    const result = await resolveShoppingExpenseCategory(tx, "household-1");

    expect(result).toBe(picked);
    expect(householdFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      select: { shoppingExpenseCategory: true },
    });
    expect(categoryFindFirstMock).not.toHaveBeenCalled();
    expect(categoryCreateMock).not.toHaveBeenCalled();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("finds an existing Groceries category case-insensitively and pins it when nothing is picked", async () => {
    householdFindUniqueMock.mockResolvedValue({ shoppingExpenseCategory: null });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", name: "groceries" });

    const result = await resolveShoppingExpenseCategory(tx, "household-1");

    expect(result).toEqual({ id: "cat-1", name: "groceries" });
    expect(categoryFindFirstMock).toHaveBeenCalledWith({
      where: {
        householdId: "household-1",
        type: "EXPENSE",
        name: { equals: "Groceries", mode: "insensitive" },
      },
    });
    expect(categoryCreateMock).not.toHaveBeenCalled();
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { shoppingExpenseCategoryId: "cat-1" },
    });
  });

  it("creates Groceries when the household has none, and pins the new one", async () => {
    householdFindUniqueMock.mockResolvedValue({ shoppingExpenseCategory: null });
    categoryFindFirstMock.mockResolvedValue(null);
    categoryCreateMock.mockResolvedValue({ id: "cat-new", name: "Groceries" });

    const result = await resolveShoppingExpenseCategory(tx, "household-1");

    expect(result).toEqual({ id: "cat-new", name: "Groceries" });
    expect(categoryCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", name: "Groceries", type: "EXPENSE" },
    });
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { shoppingExpenseCategoryId: "cat-new" },
    });
  });

  it.each([
    ["no longer an expense category", { id: "cat-x", type: "INCOME", householdId: "household-1" }],
    ["belonging to another household", { id: "cat-x", type: "EXPENSE", householdId: "household-2" }],
  ])("ignores a picked category %s and falls back to Groceries", async (_label, picked) => {
    householdFindUniqueMock.mockResolvedValue({ shoppingExpenseCategory: picked });
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", name: "Groceries" });

    const result = await resolveShoppingExpenseCategory(tx, "household-1");

    expect(result).toEqual({ id: "cat-1", name: "Groceries" });
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { shoppingExpenseCategoryId: "cat-1" },
    });
  });
});
