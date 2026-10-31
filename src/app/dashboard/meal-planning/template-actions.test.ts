// Tests GAP-52's meal-plan template actions in
// src/app/dashboard/meal-planning/template-actions.ts. All I/O (Prisma,
// requireHousehold, next/cache) is mocked, following
// src/app/dashboard/shopping-list/template-actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireHousehold: vi.fn(),
  entryFindMany: vi.fn(),
  entryCreateManyAndReturn: vi.fn(),
  planUpsert: vi.fn(),
  recipeFindMany: vi.fn(),
  templateFindFirst: vi.fn(),
  templateCreate: vi.fn(),
  templateDeleteMany: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mealPlanEntry: { findMany: m.entryFindMany, createManyAndReturn: m.entryCreateManyAndReturn },
    mealPlan: { upsert: m.planUpsert },
    recipe: { findMany: m.recipeFindMany },
    mealPlanTemplate: {
      findFirst: m.templateFindFirst,
      create: m.templateCreate,
      deleteMany: m.templateDeleteMany,
    },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: m.requireHousehold }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en), getLocale: vi.fn(async () => "en") };
});
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

const {
  saveWeekAsTemplateAction,
  applyMealPlanTemplateAction,
  deleteMealPlanTemplateAction,
  restoreMealPlanTemplateAction,
} = await import("@/app/dashboard/meal-planning/template-actions");

const household = { id: "household-1" };

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.resetAllMocks();
  m.requireHousehold.mockResolvedValue({ household });
});
m.requireHousehold.mockResolvedValue({ household });

describe("saveWeekAsTemplateAction", () => {
  const fields = { weekStartDate: "2026-01-05", name: "School week" };

  it("rejects a week key that isn't a Monday", async () => {
    const result = await saveWeekAsTemplateAction({}, formData({ ...fields, weekStartDate: "2026-01-06" }));
    expect(result.error).toMatch(/name/i);
    expect(m.templateCreate).not.toHaveBeenCalled();
  });

  it("reads only this household's week and stores offsets", async () => {
    m.entryFindMany.mockResolvedValue([
      { date: new Date("2026-01-07T00:00:00Z"), mealType: "DINNER", recipeId: "r1", freeformName: null, portions: 4 },
    ]);
    m.templateFindFirst.mockResolvedValue(null);
    m.templateCreate.mockResolvedValue({});

    const result = await saveWeekAsTemplateAction({}, formData(fields));

    expect(result).toEqual({});
    expect(m.entryFindMany.mock.calls[0][0].where.mealPlan.householdId).toBe("household-1");
    expect(m.templateCreate).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "School week",
        entries: { create: [{ dayOffset: 2, mealType: "DINNER", recipeId: "r1", freeformName: null, portions: 4 }] },
      },
    });
  });

  it("refuses an empty week and a name already taken", async () => {
    m.entryFindMany.mockResolvedValue([]);
    expect((await saveWeekAsTemplateAction({}, formData(fields))).error).toMatch(/Plan some meals/);

    m.entryFindMany.mockResolvedValue([
      { date: new Date("2026-01-05T00:00:00Z"), mealType: "DINNER", recipeId: null, freeformName: "Soup", portions: 2 },
    ]);
    m.templateFindFirst.mockResolvedValue({ id: "t1" });
    expect((await saveWeekAsTemplateAction({}, formData(fields))).error).toMatch(/already have a template/);
    expect(m.templateCreate).not.toHaveBeenCalled();
  });
});

describe("applyMealPlanTemplateAction", () => {
  const template = {
    id: "t1",
    entries: [
      { dayOffset: 0, mealType: "DINNER", recipeId: "r1", freeformName: null, portions: 4 },
      { dayOffset: 1, mealType: "LUNCH", recipeId: null, freeformName: "Soup", portions: 2 },
    ],
  };

  it("returns not-found for a template outside the caller's household (IDOR guard)", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    const result = await applyMealPlanTemplateAction("someone-elses", "2026-02-02");
    expect(result.error).toMatch(/couldn't be found/);
    expect(m.templateFindFirst.mock.calls[0][0].where).toEqual({ id: "someone-elses", householdId: "household-1" });
    expect(m.entryCreateManyAndReturn).not.toHaveBeenCalled();
  });

  it("rejects a non-Monday week", async () => {
    const result = await applyMealPlanTemplateAction("t1", "2026-02-03");
    expect(result.error).toBe("That week isn't valid.");
    expect(m.templateFindFirst).not.toHaveBeenCalled();
  });

  it("writes the unfilled slots, scoping recipes to the household", async () => {
    m.templateFindFirst.mockResolvedValue(template);
    m.entryFindMany.mockResolvedValue([{ date: new Date("2026-02-02T00:00:00Z"), mealType: "DINNER" }]);
    m.recipeFindMany.mockResolvedValue([{ id: "r1" }]);
    m.planUpsert.mockResolvedValue({ id: "plan-1" });
    m.entryCreateManyAndReturn.mockResolvedValue([{ id: "e1" }]);

    const result = await applyMealPlanTemplateAction("t1", "2026-02-02");

    expect(m.recipeFindMany.mock.calls[0][0].where).toEqual({ id: { in: ["r1"] }, householdId: "household-1" });
    // Monday dinner was filled, so only Tuesday's soup is stamped.
    const data = m.entryCreateManyAndReturn.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ mealPlanId: "plan-1", freeformName: "Soup", mealType: "LUNCH" });
    expect(result).toEqual({ copied: 1, entryIds: ["e1"] });
  });

  it("creates no plan when every slot is already filled", async () => {
    m.templateFindFirst.mockResolvedValue(template);
    m.entryFindMany.mockResolvedValue([
      { date: new Date("2026-02-02T00:00:00Z"), mealType: "DINNER" },
      { date: new Date("2026-02-03T00:00:00Z"), mealType: "LUNCH" },
    ]);
    m.recipeFindMany.mockResolvedValue([{ id: "r1" }]);

    const result = await applyMealPlanTemplateAction("t1", "2026-02-02");

    expect(result).toEqual({ copied: 0, entryIds: [] });
    expect(m.planUpsert).not.toHaveBeenCalled();
  });
});

describe("deleteMealPlanTemplateAction", () => {
  it("is scoped to the household and hands back a snapshot", async () => {
    m.templateFindFirst.mockResolvedValue({
      id: "t1",
      name: "School week",
      entries: [{ dayOffset: 0, mealType: "DINNER", recipeId: null, freeformName: "Soup", portions: 2, id: "x" }],
    });
    m.templateDeleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteMealPlanTemplateAction("t1");

    expect(m.templateDeleteMany).toHaveBeenCalledWith({ where: { id: "t1", householdId: "household-1" } });
    expect(result.snapshot).toEqual({
      name: "School week",
      entries: [{ dayOffset: 0, mealType: "DINNER", recipeId: null, freeformName: "Soup", portions: 2 }],
    });
  });

  it("returns not-found for another household's template", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    const result = await deleteMealPlanTemplateAction("t9");
    expect(result.error).toMatch(/couldn't be found/);
    expect(m.templateDeleteMany).not.toHaveBeenCalled();
  });
});

describe("restoreMealPlanTemplateAction", () => {
  const snapshot = {
    name: "School week",
    entries: [
      { dayOffset: 0, mealType: "DINNER" as const, recipeId: "mine", freeformName: null, portions: 4 },
      { dayOffset: 1, mealType: "DINNER" as const, recipeId: "theirs", freeformName: null, portions: 4 },
      { dayOffset: 2, mealType: "LUNCH" as const, recipeId: null, freeformName: "Soup", portions: 2 },
    ],
  };

  it("drops entries whose recipe isn't the caller's, keeps the rest", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    m.recipeFindMany.mockResolvedValue([{ id: "mine" }]);
    m.templateCreate.mockResolvedValue({});

    const result = await restoreMealPlanTemplateAction(snapshot);

    expect(result).toEqual({});
    expect(m.recipeFindMany.mock.calls[0][0].where.householdId).toBe("household-1");
    const created = m.templateCreate.mock.calls[0][0].data.entries.create;
    expect(created.map((e: { dayOffset: number }) => e.dayOffset)).toEqual([0, 2]);
  });

  it("rejects an invalid snapshot and a taken name", async () => {
    const bad = await restoreMealPlanTemplateAction({
      name: "x",
      entries: [{ dayOffset: 9, mealType: "DINNER", recipeId: null, freeformName: "a", portions: 1 }],
    });
    expect(bad.error).toBeDefined();
    expect(m.templateCreate).not.toHaveBeenCalled();

    m.templateFindFirst.mockResolvedValue({ id: "t2" });
    expect((await restoreMealPlanTemplateAction(snapshot)).error).toMatch(/already have a template/);
  });
});
