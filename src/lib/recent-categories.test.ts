import { describe, expect, it } from "vitest";
import {
  defaultLoggingCategoryId,
  groupCategoriesForLogging,
  recentCategoryIds,
} from "./recent-categories";

describe("recentCategoryIds (UX-109)", () => {
  it("keeps each category once, newest first, up to the limit", () => {
    const rows = ["a", "b", "a", "c", "d", "e", "f"].map((categoryId) => ({ categoryId }));
    expect(recentCategoryIds(rows, 4)).toEqual(["a", "b", "c", "d"]);
  });

  it("is empty with no transactions", () => {
    expect(recentCategoryIds([])).toEqual([]);
  });
});

describe("groupCategoriesForLogging (UX-109)", () => {
  const cats = [
    { id: "salary", type: "INCOME" as const },
    { id: "food", type: "EXPENSE" as const },
    { id: "fun", type: "EXPENSE" as const },
    { id: "rent", type: "EXPENSE" as const },
    { id: "trip", type: "SAVINGS" as const },
  ];

  it("lists expenses first, then savings, then income", () => {
    expect(groupCategoriesForLogging(cats, []).map((g) => g.type)).toEqual(["EXPENSE", "SAVINGS", "INCOME"]);
  });

  it("puts recent categories on top of their group, most recent first", () => {
    const expense = groupCategoriesForLogging(cats, ["rent", "salary", "fun"])[0];
    expect(expense.categories.map((c) => c.id)).toEqual(["rent", "fun", "food"]);
  });

  it("leaves out empty groups", () => {
    expect(groupCategoriesForLogging([cats[1]], []).map((g) => g.type)).toEqual(["EXPENSE"]);
  });
});

describe("defaultLoggingCategoryId (UX-109)", () => {
  const cats = [{ id: "a" }, { id: "b" }];

  it("prefers the Transactions tab's filter", () => {
    expect(defaultLoggingCategoryId(cats, "b", ["a"])).toBe("b");
  });

  it("falls back to the last-used category", () => {
    expect(defaultLoggingCategoryId(cats, null, ["a", "b"])).toBe("a");
  });

  it("ignores ids that are not the viewer's categories", () => {
    expect(defaultLoggingCategoryId(cats, "zzz", ["gone", "b"])).toBe("b");
  });

  it("is null with nothing to go on", () => {
    expect(defaultLoggingCategoryId(cats, undefined, [])).toBeNull();
  });
});
