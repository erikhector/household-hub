import { afterEach, describe, expect, it, vi } from "vitest";

const { groupByMock } = vi.hoisted(() => ({ groupByMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { mealPlanEntry: { groupBy: groupByMock } } }));
const { getRecipeCookedStats } = await import("./recipe-cooked-stats");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getRecipeCookedStats", () => {
  it("scopes the query to the household and to cooked recipe entries", async () => {
    groupByMock.mockResolvedValue([]);
    await getRecipeCookedStats("household-1");
    expect(groupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["recipeId"],
        where: {
          mealPlan: { householdId: "household-1" },
          recipeId: { not: null },
          consumedAt: { not: null },
        },
      }),
    );
  });

  it("returns the count and latest cooked date per recipe, and nothing for a never-cooked one", async () => {
    groupByMock.mockResolvedValue([
      { recipeId: "r1", _count: { _all: 3 }, _max: { consumedAt: new Date("2026-09-12T18:30:00.000Z") } },
      { recipeId: "r2", _count: { _all: 1 }, _max: { consumedAt: new Date("2026-08-01T10:00:00.000Z") } },
    ]);
    const stats = await getRecipeCookedStats("household-1");
    expect(stats).toEqual({
      r1: { count: 3, lastCookedAt: "2026-09-12T18:30:00.000Z" },
      r2: { count: 1, lastCookedAt: "2026-08-01T10:00:00.000Z" },
    });
    expect(stats.r3).toBeUndefined();
  });

  it("skips a group without a recipe or date", async () => {
    groupByMock.mockResolvedValue([
      { recipeId: null, _count: { _all: 2 }, _max: { consumedAt: new Date() } },
      { recipeId: "r1", _count: { _all: 1 }, _max: { consumedAt: null } },
    ]);
    expect(await getRecipeCookedStats("household-1")).toEqual({});
  });
});
