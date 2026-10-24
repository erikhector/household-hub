import { afterEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { mealPlanEntry: { findMany: findManyMock } } }));
const { getRecipePlannedDates } = await import("./recipe-planned-dates");

afterEach(() => {
  vi.clearAllMocks();
});

const NOW = new Date("2026-10-21T15:30:00.000Z");
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe("getRecipePlannedDates", () => {
  it("scopes the query to the household, to recipe entries, and to today onwards", async () => {
    findManyMock.mockResolvedValue([]);
    await getRecipePlannedDates("household-1", NOW);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mealPlan: { householdId: "household-1" },
          recipeId: { not: null },
          // Today at UTC midnight, so an entry for today still counts and
          // yesterday's does not.
          date: { gte: day("2026-10-21") },
        },
        orderBy: { date: "asc" },
      }),
    );
  });

  it("groups by recipe with each date's week start, and leaves an unplanned recipe out", async () => {
    findManyMock.mockResolvedValue([
      { recipeId: "r1", date: day("2026-10-21") },
      { recipeId: "r2", date: day("2026-10-25") },
      { recipeId: "r1", date: day("2026-10-26") },
    ]);
    const planned = await getRecipePlannedDates("household-1", NOW);
    expect(planned).toEqual({
      r1: [
        { dateKey: "2026-10-21", weekStartKey: "2026-10-19" },
        { dateKey: "2026-10-26", weekStartKey: "2026-10-26" },
      ],
      // Sunday belongs to the week that started on Monday the 19th.
      r2: [{ dateKey: "2026-10-25", weekStartKey: "2026-10-19" }],
    });
    expect(planned.r3).toBeUndefined();
  });

  it("keeps only the first three dates per recipe", async () => {
    findManyMock.mockResolvedValue(
      ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"].map((k) => ({
        recipeId: "r1",
        date: day(k),
      })),
    );
    const planned = await getRecipePlannedDates("household-1", NOW);
    expect(planned.r1.map((d) => d.dateKey)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
  });

  it("names a day once when the recipe is on two meals that day", async () => {
    findManyMock.mockResolvedValue([
      { recipeId: "r1", date: day("2026-10-22") },
      { recipeId: "r1", date: day("2026-10-22") },
      { recipeId: "r1", date: day("2026-10-23") },
    ]);
    const planned = await getRecipePlannedDates("household-1", NOW);
    expect(planned.r1.map((d) => d.dateKey)).toEqual(["2026-10-22", "2026-10-23"]);
  });

  it("skips a freeform entry", async () => {
    findManyMock.mockResolvedValue([{ recipeId: null, date: day("2026-10-22") }]);
    expect(await getRecipePlannedDates("household-1", NOW)).toEqual({});
  });
});
