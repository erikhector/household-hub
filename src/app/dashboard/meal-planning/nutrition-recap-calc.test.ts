import { describe, expect, it } from "vitest";
import { computeNutritionRecap, type NutritionRecapEntry } from "@/app/dashboard/meal-planning/nutrition-recap-calc";

function entry(overrides: Partial<NutritionRecapEntry> = {}): NutritionRecapEntry {
  return {
    recipeId: "recipe-a",
    portions: 4,
    caloriesPerServing: null,
    proteinGramsPerServing: null,
    carbsGramsPerServing: null,
    fatGramsPerServing: null,
    ...overrides,
  };
}

describe("computeNutritionRecap", () => {
  it("sums per-serving nutrition scaled by each entry's portions", () => {
    const entries: NutritionRecapEntry[] = [
      entry({ portions: 2, caloriesPerServing: 300, proteinGramsPerServing: 20, carbsGramsPerServing: 30, fatGramsPerServing: 10 }),
      entry({ portions: 3, caloriesPerServing: 200, proteinGramsPerServing: 15, carbsGramsPerServing: 25, fatGramsPerServing: 5 }),
    ];
    const totals = computeNutritionRecap(entries);
    expect(totals).toEqual({
      totalCalories: 300 * 2 + 200 * 3, // 1200
      totalProteinGrams: 20 * 2 + 15 * 3, // 85
      totalCarbsGrams: 30 * 2 + 25 * 3, // 135
      totalFatGrams: 10 * 2 + 5 * 3, // 35
      contributingEntryCount: 2,
    });
  });

  it("ignores freeform entries with no recipeId", () => {
    const entries: NutritionRecapEntry[] = [
      { recipeId: null, portions: 4, caloriesPerServing: 999, proteinGramsPerServing: 999, carbsGramsPerServing: 999, fatGramsPerServing: 999 },
      entry({ caloriesPerServing: 400 }),
    ];
    const totals = computeNutritionRecap(entries);
    expect(totals.totalCalories).toBe(400 * 4);
    expect(totals.contributingEntryCount).toBe(1);
  });

  it("sums each field independently, so a partially-filled recipe still contributes what it has", () => {
    const entries: NutritionRecapEntry[] = [
      entry({ caloriesPerServing: 500 }), // no protein/carbs/fat entered
      entry({ proteinGramsPerServing: 30 }), // no calories entered
    ];
    const totals = computeNutritionRecap(entries);
    expect(totals.totalCalories).toBe(500 * 4);
    expect(totals.totalProteinGrams).toBe(30 * 4);
    expect(totals.totalCarbsGrams).toBeNull();
    expect(totals.totalFatGrams).toBeNull();
    expect(totals.contributingEntryCount).toBe(2);
  });

  it("returns all nulls and zero count for a week with no nutrition data", () => {
    const entries: NutritionRecapEntry[] = [entry(), entry({ recipeId: null })];
    expect(computeNutritionRecap(entries)).toEqual({
      totalCalories: null,
      totalProteinGrams: null,
      totalCarbsGrams: null,
      totalFatGrams: null,
      contributingEntryCount: 0,
    });
  });

  it("returns all nulls for an empty week", () => {
    expect(computeNutritionRecap([])).toEqual({
      totalCalories: null,
      totalProteinGrams: null,
      totalCarbsGrams: null,
      totalFatGrams: null,
      contributingEntryCount: 0,
    });
  });

  it("rounds fractional totals for display", () => {
    const entries: NutritionRecapEntry[] = [
      entry({ portions: 3, proteinGramsPerServing: 10.33, carbsGramsPerServing: 22.7, fatGramsPerServing: 8.1 }),
    ];
    const totals = computeNutritionRecap(entries);
    expect(totals.totalProteinGrams).toBe(Math.round(10.33 * 3));
    expect(totals.totalCarbsGrams).toBe(Math.round(22.7 * 3));
    expect(totals.totalFatGrams).toBe(Math.round(8.1 * 3));
  });
});
