// Tests the module-private zod schemas plus every IDOR guard in
// src/app/dashboard/meal-planning/planner-actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache) is
// mocked — no database call is made. See REQUIREMENTS.md's "Testing" section
// and the identical convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  recipeFindFirstMock,
  mealPlanEntryFindFirstMock,
  mealPlanEntryCreateMock,
  mealPlanEntryUpdateMock,
  mealPlanEntryDeleteMock,
  mealPlanUpsertMock,
  revalidatePathMock,
  recipeFindManyMock,
  mealPlanEntryFindManyMock,
  mealPlanEntryCreateManyAndReturnMock,
  mealPlanEntryDeleteManyMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  recipeFindFirstMock: vi.fn(),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryCreateMock: vi.fn(),
  mealPlanEntryUpdateMock: vi.fn(),
  mealPlanEntryDeleteMock: vi.fn(),
  mealPlanUpsertMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  recipeFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  mealPlanEntryCreateManyAndReturnMock: vi.fn(),
  mealPlanEntryDeleteManyMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findFirst: recipeFindFirstMock, findMany: recipeFindManyMock },
    mealPlanEntry: {
      findFirst: mealPlanEntryFindFirstMock,
      findMany: mealPlanEntryFindManyMock,
      create: mealPlanEntryCreateMock,
      createManyAndReturn: mealPlanEntryCreateManyAndReturnMock,
      update: mealPlanEntryUpdateMock,
      delete: mealPlanEntryDeleteMock,
      deleteMany: mealPlanEntryDeleteManyMock,
    },
    mealPlan: { upsert: mealPlanUpsertMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  addMealEntryAction,
  updateMealEntryAction,
  deleteMealEntryAction,
  copyWeekAction,
  undoCopyWeekAction,
} = await import(
  "@/app/dashboard/meal-planning/planner-actions"
);

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household });
});
requireHouseholdMock.mockResolvedValue({ household });

describe("addMealEntryAction", () => {
  const base = { weekStartDate: "2026-01-05", date: "2026-01-06", mealType: "DINNER" };

  it("rejects a malformed week/date", async () => {
    const result = await addMealEntryAction({}, formData({ ...base, weekStartDate: "not-a-date" }));
    expect(result.error).toBe("Invalid week");
  });

  it("returns 'Recipe not found' for a recipe outside the caller's household (IDOR guard)", async () => {
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await addMealEntryAction({}, formData({ ...base, recipeId: "someone-elses-recipe" }));

    expect(result.error).toBe("Recipe not found");
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
  });

  it("requires a freeform name when no recipe is chosen", async () => {
    const result = await addMealEntryAction({}, formData(base));
    expect(result.error).toBe("Choose a recipe or enter a meal name");
  });

  it("creates the meal plan (upsert) and entry for a valid recipe-linked meal, defaulting portions to the recipe's own servings", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", servings: 6 });
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateMock.mockResolvedValue({});

    const result = await addMealEntryAction({}, formData({ ...base, recipeId: "recipe-1" }));

    expect(result).toEqual({});
    expect(mealPlanUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId_weekStartDate: {
            householdId: "household-1",
            weekStartDate: new Date("2026-01-05T00:00:00.000Z"),
          },
        },
      }),
    );
    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith({
      data: {
        mealPlanId: "plan-1",
        date: new Date("2026-01-06T00:00:00.000Z"),
        mealType: "DINNER",
        recipeId: "recipe-1",
        freeformName: null,
        portions: 6,
      },
    });
  });

  it("uses an explicit portions count instead of the recipe's own servings when the form sends one", async () => {
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-1", servings: 6 });
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateMock.mockResolvedValue({});

    await addMealEntryAction(
      {},
      formData({ ...base, recipeId: "recipe-1", portions: "2" }),
    );

    expect(mealPlanEntryCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ portions: 2 }) }),
    );
  });
});

describe("updateMealEntryAction", () => {
  it("returns 'Meal not found' for an entry outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    const result = await updateMealEntryAction(
      {},
      formData({ entryId: "someone-elses-entry", freeformName: "Taco night" }),
    );

    expect(result.error).toBe("Meal not found");
    expect(mealPlanEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 'Recipe not found' for a recipe outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    recipeFindFirstMock.mockResolvedValue(null);

    const result = await updateMealEntryAction(
      {},
      formData({ entryId: "entry-1", recipeId: "someone-elses-recipe" }),
    );

    expect(result.error).toBe("Recipe not found");
    expect(mealPlanEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("requires a freeform name when no recipe is chosen", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });

    const result = await updateMealEntryAction({}, formData({ entryId: "entry-1" }));
    expect(result.error).toBe("Choose a recipe or enter a meal name");
  });

  it("switches an entry to a different linked recipe, defaulting portions to its servings", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-2", servings: 3 });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await updateMealEntryAction(
      {},
      formData({ entryId: "entry-1", recipeId: "recipe-2" }),
    );

    expect(result).toEqual({});
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { recipeId: "recipe-2", freeformName: null, portions: 3 },
    });
  });

  it("uses an explicit portions count instead of the recipe's own servings when the form sends one", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    recipeFindFirstMock.mockResolvedValue({ id: "recipe-2", servings: 3 });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    await updateMealEntryAction(
      {},
      formData({ entryId: "entry-1", recipeId: "recipe-2", portions: "2" }),
    );

    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ portions: 2 }) }),
    );
  });

  it("switches an entry to a freeform name, clearing the linked recipe", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const result = await updateMealEntryAction(
      {},
      formData({ entryId: "entry-1", freeformName: "Taco night" }),
    );

    expect(result).toEqual({});
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { recipeId: null, freeformName: "Taco night", portions: 4 },
    });
  });
});

describe("deleteMealEntryAction", () => {
  it("no-ops for an entry outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    await deleteMealEntryAction("someone-elses-entry");

    expect(mealPlanEntryDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes an entry that belongs to the caller's household", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    mealPlanEntryDeleteMock.mockResolvedValue({});

    await deleteMealEntryAction("entry-1");

    expect(mealPlanEntryDeleteMock).toHaveBeenCalledWith({ where: { id: "entry-1" } });
  });
});

describe("copyWeekAction", () => {
  const FROM = "2026-01-05"; // Monday
  const TO = "2026-01-12"; // the following Monday
  const d = (key: string) => new Date(`${key}T00:00:00.000Z`);

  // findMany is called twice in a Promise.all: source week first, then the
  // target week's existing entries.
  function mockWeeks(
    source: Array<{ date: Date; mealType: string; recipeId: string | null; freeformName: string | null; portions: number }>,
    target: Array<{ date: Date; mealType: string }> = [],
  ) {
    mealPlanEntryFindManyMock.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
  }

  it.each([
    ["a malformed key", "not-a-date", TO],
    ["a non-Monday source week", "2026-01-06", TO],
    ["a non-Monday target week", FROM, "2026-01-14"],
  ])("rejects %s", async (_label, from, to) => {
    const result = await copyWeekAction(from, to);
    expect(result.error).toBe("Invalid week");
    expect(mealPlanEntryFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects copying a week onto itself", async () => {
    const result = await copyWeekAction(FROM, FROM);
    expect(result.error).toBe("Choose a different week to copy from");
  });

  it("scopes both week reads to the caller's household", async () => {
    mockWeeks([]);

    await copyWeekAction(FROM, TO);

    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mealPlan: { householdId: "household-1", weekStartDate: d(FROM) } } }),
    );
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mealPlan: { householdId: "household-1", weekStartDate: d(TO) } } }),
    );
  });

  it("writes nothing (not even a MealPlan row) when the source week is empty", async () => {
    mockWeeks([]);

    const result = await copyWeekAction(FROM, TO);

    expect(result).toEqual({ copied: 0, entryIds: [] });
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
    expect(mealPlanEntryCreateManyAndReturnMock).not.toHaveBeenCalled();
  });

  it("re-dates entries by a week, keeps recipe/freeform/portions, and lazily upserts the target plan", async () => {
    mockWeeks([
      { date: d("2026-01-06"), mealType: "DINNER", recipeId: "recipe-1", freeformName: null, portions: 2 },
      { date: d("2026-01-11"), mealType: "LUNCH", recipeId: null, freeformName: "Leftovers", portions: 4 },
    ]);
    recipeFindManyMock.mockResolvedValue([{ id: "recipe-1" }]);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-2" });
    mealPlanEntryCreateManyAndReturnMock.mockResolvedValue([{ id: "new-1" }, { id: "new-2" }]);

    const result = await copyWeekAction(FROM, TO);

    expect(result).toEqual({ copied: 2, entryIds: ["new-1", "new-2"] });
    expect(recipeFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["recipe-1"] }, householdId: "household-1" },
      select: { id: true },
    });
    expect(mealPlanUpsertMock).toHaveBeenCalledWith({
      where: { householdId_weekStartDate: { householdId: "household-1", weekStartDate: d(TO) } },
      update: {},
      create: { householdId: "household-1", weekStartDate: d(TO) },
    });
    expect(mealPlanEntryCreateManyAndReturnMock).toHaveBeenCalledWith({
      data: [
        { date: d("2026-01-13"), mealType: "DINNER", recipeId: "recipe-1", freeformName: null, portions: 2, mealPlanId: "plan-2" },
        { date: d("2026-01-18"), mealType: "LUNCH", recipeId: null, freeformName: "Leftovers", portions: 4, mealPlanId: "plan-2" },
      ],
      select: { id: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("skips target slots that already have an entry instead of overwriting them", async () => {
    mockWeeks(
      [
        { date: d("2026-01-06"), mealType: "DINNER", recipeId: null, freeformName: "Pizza", portions: 4 },
        { date: d("2026-01-06"), mealType: "LUNCH", recipeId: null, freeformName: "Soup", portions: 4 },
      ],
      [{ date: d("2026-01-13"), mealType: "DINNER" }],
    );
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-2" });
    mealPlanEntryCreateManyAndReturnMock.mockResolvedValue([{ id: "new-1" }]);

    await copyWeekAction(FROM, TO);

    const { data } = mealPlanEntryCreateManyAndReturnMock.mock.calls[0][0];
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ mealType: "LUNCH", freeformName: "Soup" });
  });

  it("drops a recipe that no longer belongs to the household, and entries left with no name (IDOR guard)", async () => {
    mockWeeks([
      { date: d("2026-01-06"), mealType: "DINNER", recipeId: "someone-elses-recipe", freeformName: null, portions: 4 },
      { date: d("2026-01-07"), mealType: "DINNER", recipeId: null, freeformName: null, portions: 4 },
    ]);
    recipeFindManyMock.mockResolvedValue([]);

    const result = await copyWeekAction(FROM, TO);

    expect(result).toEqual({ copied: 0, entryIds: [] });
    expect(mealPlanEntryCreateManyAndReturnMock).not.toHaveBeenCalled();
  });
});

describe("undoCopyWeekAction", () => {
  it("rejects an empty id list", async () => {
    const result = await undoCopyWeekAction([]);
    expect(result.error).toBe("Invalid input");
    expect(mealPlanEntryDeleteManyMock).not.toHaveBeenCalled();
  });

  it("only deletes the caller's household's uncooked entries (IDOR guard)", async () => {
    mealPlanEntryDeleteManyMock.mockResolvedValue({ count: 2 });

    const result = await undoCopyWeekAction(["new-1", "new-2"]);

    expect(result).toEqual({});
    expect(mealPlanEntryDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["new-1", "new-2"] }, consumedAt: null, mealPlan: { householdId: "household-1" } },
    });
  });
});
