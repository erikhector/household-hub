// PERF-32a: Home's household batch and the flag that decides whether it goes
// through "use cache: remote". All I/O is mocked (AGENTS.md, "Testing"); the
// directive itself is a plain string outside Next, so what's checked here is
// which path runs and what it tags.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const model = () => ({ findMany: vi.fn(async () => []), count: vi.fn(async () => 0) });
  return {
    householdTask: model(),
    inventoryItem: model(),
    shoppingList: model(),
    budgetCategory: model(),
    mealPlanEntry: model(),
    cacheTag: vi.fn(),
    cacheLife: vi.fn(),
    loadHouseholdSafeToSpend: vi.fn(async () => ({ amount: 100, status: "ok" })),
    loadMissingIngredients: vi.fn(async () => ({ items: [] })),
    getActiveBatches: vi.fn(async () => []),
    loadSampleDataState: vi.fn(async () => ({ hasSample: false, isEmpty: true })),
    logInfo: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ cacheTag: m.cacheTag, cacheLife: m.cacheLife, updateTag: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdTask: m.householdTask,
    inventoryItem: m.inventoryItem,
    shoppingList: m.shoppingList,
    budgetCategory: m.budgetCategory,
    mealPlanEntry: m.mealPlanEntry,
  },
}));
vi.mock("@/lib/household-safe-to-spend", () => ({ loadHouseholdSafeToSpend: m.loadHouseholdSafeToSpend }));
vi.mock("@/app/dashboard/meal-planning/missing-for-range", () => ({ loadMissingIngredients: m.loadMissingIngredients }));
vi.mock("@/app/dashboard/meal-planning/prepared-batches", () => ({ getActiveBatches: m.getActiveBatches }));
vi.mock("@/lib/sample-data-state", () => ({ loadSampleDataState: m.loadSampleDataState }));
vi.mock("@/lib/logger", () => ({ logger: { info: m.logInfo } }));

import { loadHomeData } from "@/lib/home-data";

const household = { id: "hh-1", budgetMonthStartDay: 1 };
// 25 Nov 2026, late evening UTC.
const NOW = new Date("2026-11-25T22:30:00Z");

function turnCacheOn() {
  vi.stubEnv("HOME_CACHE", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
}

describe("loadHomeData", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("queries directly, with no cache call, while the Home cache is off", async () => {
    vi.stubEnv("HOME_CACHE", "");
    const data = await loadHomeData(household, "user-1", NOW);
    expect(m.cacheTag).not.toHaveBeenCalled();
    expect(m.cacheLife).not.toHaveBeenCalled();
    expect(data.sampleState).toEqual({ hasSample: false, isEmpty: true });
  });

  it("goes through the cached function, tagged with the household's Home tag, when on", async () => {
    turnCacheOn();
    await loadHomeData(household, "user-1", NOW);
    expect(m.cacheTag).toHaveBeenCalledExactlyOnceWith("household:hh-1:home");
    expect(m.cacheLife).toHaveBeenCalledWith(expect.objectContaining({ revalidate: 300 }));
  });

  it("returns the same data either way", async () => {
    m.budgetCategory.count.mockResolvedValue(2);
    vi.stubEnv("HOME_CACHE", "");
    const off = await loadHomeData(household, "user-1", NOW);
    turnCacheOn();
    const on = await loadHomeData(household, "user-1", NOW);
    expect(on).toEqual(off);
    expect(off.householdBudget).toEqual({ count: 2, safeToSpend: { amount: 100, status: "ok" } });
  });

  it("scopes every query to the household and the tasks to the user", async () => {
    await loadHomeData(household, "user-1", NOW);
    expect(m.householdTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: "hh-1",
          OR: [{ assignedToMemberId: null }, { assignedToMember: { userId: "user-1" } }],
        }),
      }),
    );
    expect(m.inventoryItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "hh-1" } }));
    expect(m.getActiveBatches).toHaveBeenCalledWith("hh-1");
    expect(m.loadSampleDataState).toHaveBeenCalledWith("hh-1");
  });

  it("reads tonight from the UTC day, as the planner does", async () => {
    await loadHomeData(household, "user-1", NOW);
    expect(m.mealPlanEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ date: new Date("2026-11-25T00:00:00Z"), mealType: "DINNER" }),
      }),
    );
  });

  it("logs the batch's time only when HOME_CACHE_TIMING is on, with no ids", async () => {
    await loadHomeData(household, "user-1", NOW);
    expect(m.logInfo).not.toHaveBeenCalled();

    vi.stubEnv("HOME_CACHE_TIMING", "1");
    await loadHomeData(household, "user-1", NOW);
    expect(m.logInfo).toHaveBeenCalledExactlyOnceWith("home batch", { cache: "off", ms: expect.any(Number) });
  });

  it("asks for safe to spend in the budget period now falls in", async () => {
    m.budgetCategory.count.mockResolvedValue(1);
    await loadHomeData({ id: "hh-1", budgetMonthStartDay: 25 }, "user-1", NOW);
    const [, date, startDay] = m.loadHouseholdSafeToSpend.mock.calls[0] as unknown as [string, Date, number];
    expect(startDay).toBe(25);
    // Whatever date stands in for "now", it must name now's period.
    const { periodKeyOf } = await import("@/lib/budget-date-utils");
    expect(periodKeyOf(date, 25)).toBe(periodKeyOf(NOW, 25));
  });
});
