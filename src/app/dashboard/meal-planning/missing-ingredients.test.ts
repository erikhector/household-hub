import { describe, expect, it } from "vitest";
import { computeMissingIngredients, type IngredientNeed } from "./missing-ingredients";

describe("computeMissingIngredients", () => {
  it("proposes an ingredient whose required quantity exceeds what's on hand", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 3, onHandQuantity: 1 },
    ];

    expect(computeMissingIngredients(needs)).toEqual([
      { key: "flour", name: "Flour", unit: "cups", missingQuantity: 2 },
    ]);
  });

  it("does not propose an ingredient the household already has enough of", () => {
    const needs: IngredientNeed[] = [
      { key: "salt", name: "Salt", unit: "pcs", quantity: 1, onHandQuantity: 5 },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("does not propose an ingredient with exactly enough on hand", () => {
    const needs: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 12, onHandQuantity: 12 },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("sums required quantity for the same key across multiple recipes/days before diffing", () => {
    const needs: IngredientNeed[] = [
      { key: "egg-1", name: "Eggs", unit: "pcs", quantity: 4, onHandQuantity: 6 },
      { key: "egg-1", name: "Eggs", unit: "pcs", quantity: 4, onHandQuantity: 6 },
    ];

    // 4 + 4 = 8 required, 6 on hand (read once, not doubled) -> 2 missing.
    expect(computeMissingIngredients(needs)).toEqual([
      { key: "egg-1", name: "Eggs", unit: "pcs", missingQuantity: 2 },
    ]);
  });

  it("rounds the missing quantity to 2 decimal places", () => {
    const needs: IngredientNeed[] = [
      { key: "butter", name: "Butter", unit: "cups", quantity: 0.3, onHandQuantity: 0.1 },
    ];

    expect(computeMissingIngredients(needs)[0]?.missingQuantity).toBeCloseTo(0.2, 2);
  });

  it("sorts results by name", () => {
    const needs: IngredientNeed[] = [
      { key: "b", name: "Banana", unit: "pcs", quantity: 5, onHandQuantity: 0 },
      { key: "a", name: "Apple", unit: "pcs", quantity: 5, onHandQuantity: 0 },
    ];

    expect(computeMissingIngredients(needs).map((item) => item.name)).toEqual(["Apple", "Banana"]);
  });

  it("returns an empty list for no needs", () => {
    expect(computeMissingIngredients([])).toEqual([]);
  });
});
