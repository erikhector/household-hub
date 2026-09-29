import { describe, expect, it, vi } from "vitest";

const { categoryFindFirstMock, categoryCreateMock } = vi.hoisted(() => ({
  categoryFindFirstMock: vi.fn(),
  categoryCreateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetCategory: { findFirst: categoryFindFirstMock, create: categoryCreateMock },
  },
}));

const { findOrCreateGroceriesCategory } = await import("@/lib/budget-groceries-category");

describe("findOrCreateGroceriesCategory", () => {
  it("returns the existing category scoped to the given household when present", async () => {
    categoryFindFirstMock.mockResolvedValue({ id: "cat-1", name: "Groceries" });

    const result = await findOrCreateGroceriesCategory("household-1");

    expect(result).toEqual({ id: "cat-1", name: "Groceries" });
    expect(categoryFindFirstMock).toHaveBeenCalledWith({
      where: {
        householdId: "household-1",
        type: "EXPENSE",
        name: { equals: "Groceries", mode: "insensitive" },
      },
    });
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
