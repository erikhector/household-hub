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
  notificationUpdateManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  notificationUpdateManyMock: vi.fn(),
  // The array form of $transaction: the "queries" are whatever the model
  // mocks returned, so just resolve them all.
  transactionMock: vi.fn((queries: unknown[]) => Promise.all(queries)),
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
    notification: { updateMany: notificationUpdateManyMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  addMealEntryAction,
  updateMealEntryAction,
  deleteMealEntryAction,
  moveMealEntryAction,
  copyWeekAction,
  fillEmptyDaysAction,
  undoCopyWeekAction,
  suggestLeftoversDayAction,
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

describe("moveMealEntryAction", () => {
  const uncooked = { id: "entry-1", consumedAt: null };

  it("returns 'Meal not found' for an entry outside the caller's household (IDOR guard)", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(null);

    const result = await moveMealEntryAction(
      {},
      formData({ entryId: "someone-elses-entry", date: "2026-01-08", mealType: "LUNCH" }),
    );

    expect(result.error).toBe("Meal not found");
    expect(mealPlanEntryFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "someone-elses-entry", mealPlan: { householdId: household.id } },
      }),
    );
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses to move a meal that's already been cooked", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", consumedAt: new Date("2026-01-06T18:00:00Z") });

    const result = await moveMealEntryAction(
      {},
      formData({ entryId: "entry-1", date: "2026-01-08", mealType: "DINNER" }),
    );

    expect(result.error).toBe("A cooked meal can't be moved");
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed date", { date: "08/01/2026", mealType: "DINNER" }],
    ["an impossible calendar date", { date: "2026-02-31", mealType: "DINNER" }],
    ["an unknown meal type", { date: "2026-01-08", mealType: "BRUNCH" }],
  ])("rejects %s before touching the database", async (_label, fields) => {
    const result = await moveMealEntryAction({}, formData({ entryId: "entry-1", ...fields }));

    expect(result.error).toBeTruthy();
    expect(mealPlanEntryFindFirstMock).not.toHaveBeenCalled();
  });

  it("moves an entry within its week, re-deriving the week from the new date", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(uncooked);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });

    // 2026-01-08 is a Thursday in the week starting Monday 2026-01-05.
    const result = await moveMealEntryAction(
      {},
      formData({ entryId: "entry-1", date: "2026-01-08", mealType: "LUNCH" }),
    );

    expect(result).toEqual({});
    const weekStartDate = new Date("2026-01-05T00:00:00.000Z");
    expect(mealPlanUpsertMock).toHaveBeenCalledWith({
      where: { householdId_weekStartDate: { householdId: household.id, weekStartDate } },
      update: {},
      create: { householdId: household.id, weekStartDate },
    });
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: { mealPlanId: "plan-1", date: new Date("2026-01-08T00:00:00.000Z"), mealType: "LUNCH" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/meal-planning");
  });

  it("find-or-creates the target week's MealPlan when moving into a different week", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(uncooked);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-next-week" });

    // Sunday 2026-01-18 belongs to the week starting Monday 2026-01-12.
    await moveMealEntryAction({}, formData({ entryId: "entry-1", date: "2026-01-18", mealType: "DINNER" }));

    const weekStartDate = new Date("2026-01-12T00:00:00.000Z");
    expect(mealPlanUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId_weekStartDate: { householdId: household.id, weekStartDate } },
        create: { householdId: household.id, weekStartDate },
      }),
    );
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mealPlanId: "plan-next-week" }) }),
    );
  });

  it("ignores any week key or household id the client sends", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(uncooked);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });

    await moveMealEntryAction(
      {},
      formData({
        entryId: "entry-1",
        date: "2026-01-08",
        mealType: "LUNCH",
        weekStartDate: "2030-06-03",
        householdId: "someone-elses-household",
      }),
    );

    expect(mealPlanUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId_weekStartDate: {
            householdId: household.id,
            weekStartDate: new Date("2026-01-05T00:00:00.000Z"),
          },
        },
      }),
    );
  });

  it("dismisses an open 'meal not logged' reminder for the moved entry in the same transaction", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue(uncooked);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });

    await moveMealEntryAction({}, formData({ entryId: "entry-1", date: "2026-01-08", mealType: "LUNCH" }));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        householdId: household.id,
        mealPlanEntryId: "entry-1",
        kind: "MEAL_NOT_LOGGED",
        dismissedAt: null,
      },
      data: { dismissedAt: expect.any(Date) },
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

describe("suggestLeftoversDayAction", () => {
  it("rejects a malformed date without querying", async () => {
    expect(await suggestLeftoversDayAction("tomorrow")).toEqual({ error: "Invalid date" });
    expect(await suggestLeftoversDayAction("2026-13-45")).toEqual({ error: "Invalid date" });
    expect(mealPlanEntryFindManyMock).not.toHaveBeenCalled();
  });

  it("looks only at the caller's household's dinners after the date and suggests the first free day", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { date: new Date("2026-01-06T00:00:00.000Z") },
      { date: new Date("2026-01-07T00:00:00.000Z") },
    ]);

    expect(await suggestLeftoversDayAction("2026-01-05")).toEqual({ date: "2026-01-08" });

    const where = mealPlanEntryFindManyMock.mock.calls[0][0].where;
    expect(where.mealPlan).toEqual({ householdId: "household-1" });
    expect(where.mealType).toBe("DINNER");
    expect(where.date.gt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
  });

  it("writes nothing", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([]);
    await suggestLeftoversDayAction("2026-01-05");
    expect(mealPlanEntryCreateMock).not.toHaveBeenCalled();
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
  });
});

describe("fillEmptyDaysAction", () => {
  const WEEK = "2026-01-05"; // Monday
  const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
  const picks = [
    { date: "2026-01-05", recipeId: "r1" },
    { date: "2026-01-07", recipeId: "r2" },
  ];

  it.each([
    ["a non-Monday week", "2026-01-06", picks],
    ["no picks", WEEK, []],
  ])("rejects %s", async (_label, week, p) => {
    const result = await fillEmptyDaysAction(week, p);
    expect(result.error).toBeTruthy();
    expect(mealPlanEntryCreateManyAndReturnMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a date outside the week", [{ date: "2026-01-12", recipeId: "r1" }]],
    ["the same day twice", [picks[0], { date: "2026-01-05", recipeId: "r2" }]],
    ["the same recipe twice", [picks[0], { date: "2026-01-06", recipeId: "r1" }]],
  ])("rejects %s", async (_label, p) => {
    const result = await fillEmptyDaysAction(WEEK, p);
    expect(result.error).toBe("Invalid input");
    expect(recipeFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects a recipe outside the household and writes nothing (IDOR guard)", async () => {
    recipeFindManyMock.mockResolvedValue([{ id: "r1", servings: 4 }]);
    mealPlanEntryFindManyMock.mockResolvedValue([]);

    const result = await fillEmptyDaysAction(WEEK, picks);

    expect(result.error).toBe("Recipe not found");
    expect(recipeFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["r1", "r2"] }, householdId: "household-1" },
      select: { id: true, servings: true },
    });
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
    expect(mealPlanEntryCreateManyAndReturnMock).not.toHaveBeenCalled();
  });

  it("writes one dinner per day with the recipe's servings and returns the ids for Undo", async () => {
    recipeFindManyMock.mockResolvedValue([
      { id: "r1", servings: 4 },
      { id: "r2", servings: 2 },
    ]);
    mealPlanEntryFindManyMock.mockResolvedValue([]);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateManyAndReturnMock.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);

    const result = await fillEmptyDaysAction(WEEK, picks);

    expect(result).toEqual({ copied: 2, entryIds: ["n1", "n2"] });
    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith({
      where: { mealPlan: { householdId: "household-1", weekStartDate: d(WEEK) } },
      select: { date: true },
    });
    expect(mealPlanEntryCreateManyAndReturnMock).toHaveBeenCalledWith({
      data: [
        { date: d("2026-01-05"), mealType: "DINNER", recipeId: "r1", freeformName: null, portions: 4, mealPlanId: "plan-1" },
        { date: d("2026-01-07"), mealType: "DINNER", recipeId: "r2", freeformName: null, portions: 2, mealPlanId: "plan-1" },
      ],
      select: { id: true },
    });
  });

  it("skips a day that gained an entry since the preview, and writes no plan when none are left", async () => {
    recipeFindManyMock.mockResolvedValue([
      { id: "r1", servings: 4 },
      { id: "r2", servings: 2 },
    ]);
    mealPlanEntryFindManyMock.mockResolvedValue([{ date: d("2026-01-05") }]);
    mealPlanUpsertMock.mockResolvedValue({ id: "plan-1" });
    mealPlanEntryCreateManyAndReturnMock.mockResolvedValue([{ id: "n2" }]);

    const result = await fillEmptyDaysAction(WEEK, picks);

    expect(result).toEqual({ copied: 1, entryIds: ["n2"] });
    expect(mealPlanEntryCreateManyAndReturnMock.mock.calls[0][0].data).toHaveLength(1);

    mealPlanEntryFindManyMock.mockResolvedValue([{ date: d("2026-01-05") }, { date: d("2026-01-07") }]);
    mealPlanUpsertMock.mockClear();
    expect(await fillEmptyDaysAction(WEEK, picks)).toEqual({ copied: 0, entryIds: [] });
    expect(mealPlanUpsertMock).not.toHaveBeenCalled();
  });
});
