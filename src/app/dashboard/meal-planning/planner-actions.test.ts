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
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  recipeFindFirstMock: vi.fn(),
  mealPlanEntryFindFirstMock: vi.fn(),
  mealPlanEntryCreateMock: vi.fn(),
  mealPlanEntryUpdateMock: vi.fn(),
  mealPlanEntryDeleteMock: vi.fn(),
  mealPlanUpsertMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recipe: { findFirst: recipeFindFirstMock },
    mealPlanEntry: {
      findFirst: mealPlanEntryFindFirstMock,
      create: mealPlanEntryCreateMock,
      update: mealPlanEntryUpdateMock,
      delete: mealPlanEntryDeleteMock,
    },
    mealPlan: { upsert: mealPlanUpsertMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { addMealEntryAction, updateMealEntryAction, deleteMealEntryAction } = await import(
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
