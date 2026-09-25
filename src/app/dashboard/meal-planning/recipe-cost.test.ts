import { describe, expect, it } from "vitest";
import { computeRecipeCost, type RecipeCostIngredient } from "./recipe-cost";

const priced = (
  quantity: number,
  unit: string,
  itemUnit: string,
  lastKnownPrice: number | null,
): RecipeCostIngredient => ({ quantity, unit, inventoryItem: { unit: itemUnit, lastKnownPrice } });

describe("computeRecipeCost", () => {
  it("sums quantity × lastKnownPrice and splits it across servings", () => {
    const cost = computeRecipeCost(
      [priced(2, "pcs", "pcs", 10), priced(0.5, "kg", "kg", 50)],
      4,
    );

    // 2 × 10 + 0.5 × 50 = 45; 45 / 4 = 11.25
    expect(cost).toEqual({ total: 45, perServing: 11.25, pricedCount: 2, skippedCount: 0 });
  });

  it("matches units case- and whitespace-insensitively", () => {
    expect(computeRecipeCost([priced(3, " PCS ", "pcs", 2)], 1)).toMatchObject({ total: 6 });
  });

  it("converts the recipe's unit into the linked item's unit before pricing", () => {
    // 500 g of an item priced per kg costs half its price; 3 tbsp (45 ml)
    // of oil priced per liter costs 0.045 of it.
    const cost = computeRecipeCost(
      [priced(500, "g", "kg", 80), priced(3, "tbsp", "l", 100)],
      2,
    );

    expect(cost).toEqual({ total: 44.5, perServing: 22.25, pricedCount: 2, skippedCount: 0 });
  });

  it("skips and counts ingredients with no price, no linked item, or an unconvertible unit", () => {
    const cost = computeRecipeCost(
      [
        priced(1, "pcs", "pcs", 12),
        priced(1, "pcs", "pcs", null), // never priced
        { quantity: 1, unit: "pcs", inventoryItem: null }, // unlinked
        priced(2, "cups", "kg", 30), // volume vs weight — no density
        priced(1, "clove", "pcs", 5), // unrecognized count unit
      ],
      2,
    );

    expect(cost).toEqual({ total: 12, perServing: 6, pricedCount: 1, skippedCount: 4 });
  });

  it("returns null when no ingredient could be priced", () => {
    expect(computeRecipeCost([priced(1, "pcs", "pcs", null)], 4)).toBeNull();
    expect(computeRecipeCost([{ quantity: 1, unit: "pcs", inventoryItem: null }], 4)).toBeNull();
    expect(computeRecipeCost([], 4)).toBeNull();
  });

  it("counts a price of 0 as priced rather than missing", () => {
    expect(computeRecipeCost([priced(1, "pcs", "pcs", 0)], 1)).toEqual({
      total: 0,
      perServing: 0,
      pricedCount: 1,
      skippedCount: 0,
    });
  });

  it("rounds to two decimals", () => {
    expect(computeRecipeCost([priced(1, "pcs", "pcs", 10)], 3)).toEqual({
      total: 10,
      perServing: 3.33,
      pricedCount: 1,
      skippedCount: 0,
    });
  });

  it("treats a non-positive servings count as 1 instead of dividing by zero", () => {
    expect(computeRecipeCost([priced(1, "pcs", "pcs", 10)], 0)).toMatchObject({ perServing: 10 });
  });
});
