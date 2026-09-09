import { describe, expect, it } from "vitest";
import { computeCookedIngredients, type CookedIngredientNeed } from "./cooked-ingredients";

describe("computeCookedIngredients", () => {
  it("suggests the required quantity when the recipe unit matches the inventory item's unit", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "flour-1",
        name: "Flour",
        onHandQuantity: 5,
        onHandUnit: "cups",
        requiredQuantity: 2,
        requiredUnit: "cups",
      },
    ];

    expect(computeCookedIngredients(needs)).toEqual([
      {
        key: "flour-1",
        inventoryItemId: "flour-1",
        name: "Flour",
        unit: "cups",
        onHandQuantity: 5,
        suggestedQuantity: 2,
        requiredQuantity: 2,
        requiredUnit: "cups",
        unitMismatch: false,
      },
    ]);
  });

  it("suggests 0 and flags a mismatch when the recipe unit differs from the inventory item's unit", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "flour-1",
        name: "Flour",
        onHandQuantity: 500,
        onHandUnit: "g",
        requiredQuantity: 2,
        requiredUnit: "cups",
      },
    ];

    const result = computeCookedIngredients(needs);
    expect(result[0]?.suggestedQuantity).toBe(0);
    expect(result[0]?.unitMismatch).toBe(true);
    expect(result[0]?.requiredQuantity).toBe(2);
    expect(result[0]?.requiredUnit).toBe("cups");
  });

  it("treats units as matching case-insensitively and ignoring surrounding whitespace", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "milk-1",
        name: "Milk",
        onHandQuantity: 10,
        onHandUnit: " Liters ",
        requiredQuantity: 1,
        requiredUnit: "liters",
      },
    ];

    const result = computeCookedIngredients(needs);
    expect(result[0]?.suggestedQuantity).toBe(1);
    expect(result[0]?.unitMismatch).toBe(false);
  });

  it("sums required quantity for the same inventory item across multiple ingredient rows", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "egg-1",
        name: "Eggs",
        onHandQuantity: 12,
        onHandUnit: "pcs",
        requiredQuantity: 2,
        requiredUnit: "pcs",
      },
      {
        inventoryItemId: "egg-1",
        name: "Eggs",
        onHandQuantity: 12,
        onHandUnit: "pcs",
        requiredQuantity: 3,
        requiredUnit: "pcs",
      },
    ];

    expect(computeCookedIngredients(needs)).toEqual([
      {
        key: "egg-1",
        inventoryItemId: "egg-1",
        name: "Eggs",
        unit: "pcs",
        onHandQuantity: 12,
        suggestedQuantity: 5,
        requiredQuantity: 5,
        requiredUnit: "pcs",
        unitMismatch: false,
      },
    ]);
  });

  it("flags a mismatch for the whole item when only one of several rows disagrees on unit", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "butter-1",
        name: "Butter",
        onHandQuantity: 500,
        onHandUnit: "g",
        requiredQuantity: 100,
        requiredUnit: "g",
      },
      {
        inventoryItemId: "butter-1",
        name: "Butter",
        onHandQuantity: 500,
        onHandUnit: "g",
        requiredQuantity: 1,
        requiredUnit: "cup",
      },
    ];

    const result = computeCookedIngredients(needs);
    // The matching row still contributes its 100g; the mismatched cup row
    // doesn't, but does flip unitMismatch so the review dialog surfaces it.
    expect(result[0]?.suggestedQuantity).toBe(100);
    expect(result[0]?.unitMismatch).toBe(true);
    expect(result[0]?.requiredQuantity).toBe(101);
  });

  it("rounds the suggested and required quantities to 2 decimal places", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "sugar-1",
        name: "Sugar",
        onHandQuantity: 1,
        onHandUnit: "cups",
        requiredQuantity: 0.333,
        requiredUnit: "cups",
      },
    ];

    expect(computeCookedIngredients(needs)[0]?.suggestedQuantity).toBeCloseTo(0.33, 2);
  });

  it("sorts results by name", () => {
    const needs: CookedIngredientNeed[] = [
      {
        inventoryItemId: "b",
        name: "Banana",
        onHandQuantity: 5,
        onHandUnit: "pcs",
        requiredQuantity: 1,
        requiredUnit: "pcs",
      },
      {
        inventoryItemId: "a",
        name: "Apple",
        onHandQuantity: 5,
        onHandUnit: "pcs",
        requiredQuantity: 1,
        requiredUnit: "pcs",
      },
    ];

    expect(computeCookedIngredients(needs).map((item) => item.name)).toEqual(["Apple", "Banana"]);
  });

  it("returns an empty list for no needs", () => {
    expect(computeCookedIngredients([])).toEqual([]);
  });
});
