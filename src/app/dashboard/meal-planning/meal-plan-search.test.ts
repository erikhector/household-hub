import { afterEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { mealPlanEntry: { findMany: findManyMock } } }));
const { searchMealPlan, MEAL_SEARCH_LIMIT } = await import("./meal-plan-search");

afterEach(() => {
  vi.clearAllMocks();
});

const TODAY = new Date("2026-10-24T15:30:00.000Z");

describe("searchMealPlan", () => {
  it("does not query for fewer than two characters", async () => {
    expect(await searchMealPlan("h1", "l", TODAY)).toEqual([]);
    expect(await searchMealPlan("h1", "  l ", TODAY)).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("scopes to the household, matches recipe title or freeform name case-insensitively, within a year either side", async () => {
    findManyMock.mockResolvedValue([]);
    await searchMealPlan("h1", " Lasa ", TODAY);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where.mealPlan).toEqual({ householdId: "h1" });
    expect(args.where.OR).toEqual([
      { freeformName: { contains: "Lasa", mode: "insensitive" } },
      { recipe: { name: { contains: "Lasa", mode: "insensitive" } } },
    ]);
    // 365 days before and after the UTC day, not the time of day.
    expect(args.where.date.gte).toEqual(new Date("2025-10-24T00:00:00.000Z"));
    expect(args.where.date.lte).toEqual(new Date("2027-10-24T00:00:00.000Z"));
  });

  it("asks for newest first and caps at 20", async () => {
    findManyMock.mockResolvedValue([]);
    await searchMealPlan("h1", "taco", TODAY);
    const args = findManyMock.mock.calls[0][0];
    expect(args.take).toBe(20);
    expect(MEAL_SEARCH_LIMIT).toBe(20);
    expect(args.orderBy[0]).toEqual({ date: "desc" });
  });

  it("names a recipe entry by its recipe and a custom meal by its freeform name, with the week it sits in", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "e1",
        date: new Date("2026-11-08T00:00:00.000Z"), // a Sunday
        mealType: "DINNER",
        freeformName: null,
        recipe: { name: "Lasagna" },
      },
      {
        id: "e2",
        date: new Date("2026-11-03T00:00:00.000Z"), // a Tuesday
        mealType: "LUNCH",
        freeformName: "Leftover lasagna",
        recipe: null,
      },
    ]);
    expect(await searchMealPlan("h1", "lasagna", TODAY)).toEqual([
      { id: "e1", dateKey: "2026-11-08", mealType: "DINNER", name: "Lasagna", weekStartKey: "2026-11-02" },
      { id: "e2", dateKey: "2026-11-03", mealType: "LUNCH", name: "Leftover lasagna", weekStartKey: "2026-11-02" },
    ]);
  });
});
