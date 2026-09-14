import { describe, expect, it } from "vitest";
import { computeMealVarietyRecap, type MealVarietyEntry } from "@/app/dashboard/meal-planning/meal-variety-calc";

const now = new Date(2026, 8, 30); // Sept 30, 2026

describe("computeMealVarietyRecap", () => {
  it("counts distinct recipes within the trailing 30-day window", () => {
    const entries: MealVarietyEntry[] = [
      { date: new Date(2026, 8, 1), recipeId: "recipe-a" },
      { date: new Date(2026, 8, 10), recipeId: "recipe-b" },
      { date: new Date(2026, 8, 20), recipeId: "recipe-a" }, // repeat, doesn't add
      { date: new Date(2026, 8, 29), recipeId: "recipe-c" },
    ];
    expect(computeMealVarietyRecap({ entries, now }).distinctRecipeCount).toBe(3);
  });

  it("ignores freeform entries with no recipeId", () => {
    const entries: MealVarietyEntry[] = [
      { date: new Date(2026, 8, 5), recipeId: null },
      { date: new Date(2026, 8, 6), recipeId: "recipe-a" },
    ];
    expect(computeMealVarietyRecap({ entries, now }).distinctRecipeCount).toBe(1);
  });

  it("excludes entries older than the window", () => {
    const entries: MealVarietyEntry[] = [
      { date: new Date(2026, 7, 20), recipeId: "recipe-old" }, // 41 days before `now`
      { date: new Date(2026, 8, 15), recipeId: "recipe-new" },
    ];
    expect(computeMealVarietyRecap({ entries, now }).distinctRecipeCount).toBe(1);
  });

  it("excludes entries dated after `now`", () => {
    const entries: MealVarietyEntry[] = [{ date: new Date(2026, 9, 1), recipeId: "recipe-future" }];
    expect(computeMealVarietyRecap({ entries, now }).distinctRecipeCount).toBe(0);
  });

  it("returns zero for a quiet window rather than treating it specially", () => {
    expect(computeMealVarietyRecap({ entries: [], now }).distinctRecipeCount).toBe(0);
  });

  it("respects a custom windowDays override", () => {
    const entries: MealVarietyEntry[] = [{ date: new Date(2026, 8, 25), recipeId: "recipe-a" }];
    expect(computeMealVarietyRecap({ entries, now, windowDays: 3 }).distinctRecipeCount).toBe(0);
    expect(computeMealVarietyRecap({ entries, now, windowDays: 10 }).distinctRecipeCount).toBe(1);
  });
});
