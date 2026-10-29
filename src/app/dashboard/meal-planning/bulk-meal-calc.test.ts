import { describe, expect, it } from "vitest";
import { canMarkEaten, canRePortion, dayDiff, mapBulkMove, splitCooked } from "@/app/dashboard/meal-planning/bulk-meal-calc";

describe("dayDiff", () => {
  it("counts whole days, across a month end and a DST change", () => {
    expect(dayDiff("2026-01-30", "2026-02-02")).toBe(3);
    expect(dayDiff("2026-03-28", "2026-03-30")).toBe(2);
    expect(dayDiff("2026-01-05", "2026-01-03")).toBe(-2);
  });
});

describe("mapBulkMove", () => {
  const entries = [
    { id: "mon", date: "2026-01-05", mealType: "DINNER" as const },
    { id: "tue", date: "2026-01-06", mealType: "LUNCH" as const },
    { id: "thu", date: "2026-01-08", mealType: "DINNER" as const },
  ];

  it("puts the earliest meal on the target day and keeps the group's shape", () => {
    expect(mapBulkMove(entries, "2026-01-07", null)).toEqual([
      { id: "mon", date: "2026-01-07", mealType: "DINNER" },
      { id: "tue", date: "2026-01-08", mealType: "LUNCH" },
      { id: "thu", date: "2026-01-10", mealType: "DINNER" },
    ]);
  });

  it("shifts back as well as forward, and across a week and month boundary", () => {
    const moved = mapBulkMove(entries, "2026-01-30", null);
    expect(moved.map((m) => m.date)).toEqual(["2026-01-30", "2026-01-31", "2026-02-02"]);
    expect(mapBulkMove(entries, "2026-01-04", null).map((m) => m.date)).toEqual([
      "2026-01-04",
      "2026-01-05",
      "2026-01-07",
    ]);
  });

  it("does not depend on the order the entries arrive in", () => {
    expect(mapBulkMove([...entries].reverse(), "2026-01-07", null).map((m) => [m.id, m.date])).toEqual([
      ["thu", "2026-01-10"],
      ["tue", "2026-01-08"],
      ["mon", "2026-01-07"],
    ]);
  });

  it("sets one slot for all when a meal type is given, otherwise keeps each", () => {
    expect(mapBulkMove(entries, "2026-01-05", "SNACK").every((m) => m.mealType === "SNACK")).toBe(true);
    expect(mapBulkMove(entries, "2026-01-05", null).map((m) => m.mealType)).toEqual(["DINNER", "LUNCH", "DINNER"]);
  });

  it("returns nothing for no entries", () => {
    expect(mapBulkMove([], "2026-01-05", null)).toEqual([]);
  });
});

describe("splitCooked", () => {
  it("leaves cooked entries out and counts them", () => {
    const result = splitCooked([
      { id: "a", consumedAt: null },
      { id: "b", consumedAt: new Date() },
    ]);
    expect(result.editable.map((e) => e.id)).toEqual(["a"]);
    expect(result.skipped).toBe(1);
  });
});

describe("canRePortion", () => {
  it("is true only for a recipe meal not eating from a batch", () => {
    expect(canRePortion({ recipeId: "r", preparedBatchId: null })).toBe(true);
    expect(canRePortion({ recipeId: null, preparedBatchId: null })).toBe(false);
    expect(canRePortion({ recipeId: "r", preparedBatchId: "b" })).toBe(false);
  });
});

describe("canMarkEaten", () => {
  it("takes only meals eating from a prepared batch", () => {
    expect(canMarkEaten({ preparedBatchId: "b1" })).toBe(true);
    expect(canMarkEaten({ preparedBatchId: null })).toBe(false);
  });
});
