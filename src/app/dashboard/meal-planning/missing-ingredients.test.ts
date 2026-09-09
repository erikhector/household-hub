import { describe, expect, it } from "vitest";
import { computeMissingIngredients, type IngredientNeed } from "./missing-ingredients";

describe("computeMissingIngredients", () => {
  it("proposes an ingredient whose required quantity exceeds what's on hand", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 3, onHandQuantity: 1, onHandUnit: "cups" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([
      { key: "flour::cups", name: "Flour", unit: "cups", missingQuantity: 2 },
    ]);
  });

  it("does not propose an ingredient the household already has enough of", () => {
    const needs: IngredientNeed[] = [
      { key: "salt", name: "Salt", unit: "pcs", quantity: 1, onHandQuantity: 5, onHandUnit: "pcs" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("does not propose an ingredient with exactly enough on hand", () => {
    const needs: IngredientNeed[] = [
      { key: "eggs", name: "Eggs", unit: "pcs", quantity: 12, onHandQuantity: 12, onHandUnit: "pcs" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("sums required quantity for the same key and unit across multiple recipes/days before diffing", () => {
    const needs: IngredientNeed[] = [
      { key: "egg-1", name: "Eggs", unit: "pcs", quantity: 4, onHandQuantity: 6, onHandUnit: "pcs" },
      { key: "egg-1", name: "Eggs", unit: "pcs", quantity: 4, onHandQuantity: 6, onHandUnit: "pcs" },
    ];

    // 4 + 4 = 8 required, 6 on hand (read once, not doubled) -> 2 missing.
    expect(computeMissingIngredients(needs)).toEqual([
      { key: "egg-1::pcs", name: "Eggs", unit: "pcs", missingQuantity: 2 },
    ]);
  });

  it("keeps requirements for the same ingredient in different units as separate line items instead of summing them", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "flour", name: "Flour", unit: "g", quantity: 200, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeMissingIngredients(needs);

    expect(result).toEqual([
      { key: "flour::cups", name: "Flour", unit: "cups", missingQuantity: 2 },
      { key: "flour::g", name: "Flour", unit: "g", missingQuantity: 200 },
    ]);
    // Distinct keys so the review dialog can toggle each unit independently.
    expect(new Set(result.map((item) => item.key)).size).toBe(2);
  });

  it("treats units as the same group case-insensitively and ignoring surrounding whitespace", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "Cups", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "flour", name: "Flour", unit: " cups ", quantity: 1, onHandQuantity: 0, onHandUnit: null },
    ];

    expect(computeMissingIngredients(needs)).toEqual([
      { key: "flour::cups", name: "Flour", unit: "Cups", missingQuantity: 3 },
    ]);
  });

  it("only subtracts on-hand inventory from a required-quantity group whose unit matches the inventory item's own unit", () => {
    const needs: IngredientNeed[] = [
      // Required in cups, but the linked inventory item is tracked in
      // grams — can't reconcile without a conversion table, so the full 2
      // cups is reported missing rather than subtracting the 5g on hand.
      { key: "flour", name: "Flour", unit: "cups", quantity: 2, onHandQuantity: 5, onHandUnit: "g" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([
      { key: "flour::cups", name: "Flour", unit: "cups", missingQuantity: 2 },
    ]);
  });

  it("does not propose an ingredient when the on-hand unit matches and covers the requirement", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "g", quantity: 200, onHandQuantity: 500, onHandUnit: "g" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("rounds the missing quantity to 2 decimal places", () => {
    const needs: IngredientNeed[] = [
      { key: "butter", name: "Butter", unit: "cups", quantity: 0.3, onHandQuantity: 0.1, onHandUnit: "cups" },
    ];

    expect(computeMissingIngredients(needs)[0]?.missingQuantity).toBeCloseTo(0.2, 2);
  });

  it("sorts results by name", () => {
    const needs: IngredientNeed[] = [
      { key: "b", name: "Banana", unit: "pcs", quantity: 5, onHandQuantity: 0, onHandUnit: null },
      { key: "a", name: "Apple", unit: "pcs", quantity: 5, onHandQuantity: 0, onHandUnit: null },
    ];

    expect(computeMissingIngredients(needs).map((item) => item.name)).toEqual(["Apple", "Banana"]);
  });

  it("returns an empty list for no needs", () => {
    expect(computeMissingIngredients([])).toEqual([]);
  });

  it("does not propose an ingredient whose on-hand quantity is in a different but convertible unit and covers the requirement", () => {
    const needs: IngredientNeed[] = [
      // 1 liter on hand comfortably covers a 3 tbsp requirement (45ml).
      { key: "oil", name: "Olive oil", unit: "tbsp", quantity: 3, onHandQuantity: 1, onHandUnit: "l" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([]);
  });

  it("reports the shortfall converted into the required unit when on-hand is insufficient but the unit is convertible", () => {
    const needs: IngredientNeed[] = [
      // 30ml on hand, 4 tbsp (60ml) required -> 2 tbsp (30ml) short.
      { key: "oil", name: "Olive oil", unit: "tbsp", quantity: 4, onHandQuantity: 30, onHandUnit: "ml" },
    ];

    expect(computeMissingIngredients(needs)).toEqual([
      { key: "oil::tbsp", name: "Olive oil", unit: "tbsp", missingQuantity: 2 },
    ]);
  });

  it("merges requirements for the same ingredient expressed in different but convertible units into one line", () => {
    const needs: IngredientNeed[] = [
      { key: "oil", name: "Olive oil", unit: "tbsp", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "oil", name: "Olive oil", unit: "tsp", quantity: 3, onHandQuantity: 0, onHandUnit: null },
    ];

    // 2 tbsp (30ml) + 3 tsp (15ml) = 45ml = 3 tbsp, expressed in the first
    // cluster's unit (tbsp, from whichever need was seen first).
    expect(computeMissingIngredients(needs)).toEqual([
      { key: "oil::tbsp", name: "Olive oil", unit: "tbsp", missingQuantity: 3 },
    ]);
  });

  it("still keeps units from different dimensions separate even when merging convertible ones", () => {
    const needs: IngredientNeed[] = [
      { key: "flour", name: "Flour", unit: "cups", quantity: 1, onHandQuantity: 0, onHandUnit: null },
      { key: "flour", name: "Flour", unit: "tbsp", quantity: 2, onHandQuantity: 0, onHandUnit: null },
      { key: "flour", name: "Flour", unit: "g", quantity: 100, onHandQuantity: 0, onHandUnit: null },
    ];

    const result = computeMissingIngredients(needs);
    // cups + tbsp merge (both volume); g stays separate (different dimension).
    expect(result).toEqual([
      { key: "flour::cups", name: "Flour", unit: "cups", missingQuantity: 1.13 },
      { key: "flour::g", name: "Flour", unit: "g", missingQuantity: 100 },
    ]);
  });
});
