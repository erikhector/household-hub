import { describe, expect, it } from "vitest";
import { computeCookableRecipes } from "./cookable-recipes";
import type { IngredientNeed } from "./missing-ingredients";

describe("computeCookableRecipes", () => {
  it("surfaces a recipe with everything on hand as fully ready", () => {
    const needs: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];

    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Omelette", needs }])).toEqual([
      { recipeId: "r1", recipeName: "Omelette", missingIngredientNames: [] },
    ]);
  });

  it("excludes a recipe missing more than the surfaced limit of 2 ingredients", () => {
    const needs: IngredientNeed[] = [
      { key: "a", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "b", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "c", name: "Butter", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Cake", needs }])).toEqual([]);
  });

  it("includes a recipe missing exactly 2 ingredients", () => {
    const needs: IngredientNeed[] = [
      { key: "a", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "b", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeCookableRecipes([{ recipeId: "r1", recipeName: "Cake", needs }]);
    expect(result).toHaveLength(1);
    expect(result[0].missingIngredientNames).toEqual(["Flour", "Sugar"]);
  });

  it("excludes a recipe with no ingredients instead of treating it as trivially ready", () => {
    expect(computeCookableRecipes([{ recipeId: "r1", recipeName: "Mystery", needs: [] }])).toEqual([]);
  });

  it("sorts fully-stocked recipes before ones missing ingredients, then by missing count, then name", () => {
    const ready: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 2, onHandQuantity: 12, onHandUnit: "pcs" },
    ];
    const missingOne: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
    ];
    const missingTwo: IngredientNeed[] = [
      { key: "sugar", name: "Sugar", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "butter", name: "Butter", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeCookableRecipes([
      { recipeId: "r3", recipeName: "Cake", needs: missingTwo },
      { recipeId: "r2", recipeName: "Pancakes", needs: missingOne },
      { recipeId: "r1", recipeName: "Zzz Omelette", needs: ready },
      { recipeId: "r4", recipeName: "Aaa Omelette", needs: ready },
    ]);

    expect(result.map((r) => r.recipeName)).toEqual(["Aaa Omelette", "Zzz Omelette", "Pancakes", "Cake"]);
  });

  it("returns an empty list for no recipes", () => {
    expect(computeCookableRecipes([])).toEqual([]);
  });
});
