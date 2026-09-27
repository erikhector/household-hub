import { describe, expect, it } from "vitest";
import {
  computeRecipeCost,
  unitPriceFromLastPurchase,
  type RecipeCostIngredient,
  type RecipeCostPurchase,
} from "./recipe-cost";

// An ingredient whose linked item's lastKnownPrice was set by buying
// `bought` as one shopping-list line: the line's price is lastKnownPrice,
// which is how every writer of it leaves the data. `bought: null` models a
// price whose line is gone (list deleted, price corrected afterwards).
const priced = (
  quantity: number,
  unit: string,
  itemUnit: string,
  lastKnownPrice: number | null,
  bought: { quantity: number; unit?: string } | null = { quantity: 1 },
): RecipeCostIngredient => ({
  quantity,
  unit,
  inventoryItem: {
    unit: itemUnit,
    lastKnownPrice,
    purchases:
      bought && lastKnownPrice != null
        ? [{ quantity: bought.quantity, unit: bought.unit ?? itemUnit, price: lastKnownPrice }]
        : [],
  },
});

describe("unitPriceFromLastPurchase", () => {
  it("divides the line price by the quantity that line bought", () => {
    expect(
      unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases: [{ quantity: 500, unit: "g", price: 24 }] }),
    ).toBeCloseTo(0.048);
  });

  it("converts the purchased line's unit into the item's", () => {
    // 0.5 kg bought for 24, item kept in g → 24 / 500 per g.
    expect(
      unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases: [{ quantity: 0.5, unit: "kg", price: 24 }] }),
    ).toBeCloseTo(0.048);
  });

  it("uses the newest line whose price matches lastKnownPrice, not just the newest line", () => {
    const purchases: RecipeCostPurchase[] = [
      { quantity: 1000, unit: "g", price: 40 }, // newer row, but not what set the price
      { quantity: 500, unit: "g", price: 24 },
      { quantity: 250, unit: "g", price: 24 }, // older, same price
    ];
    expect(unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases })).toBeCloseTo(0.048);
  });

  it("returns null when the purchase can't be recovered or converted", () => {
    // Never priced.
    expect(unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: null, purchases: [] })).toBeNull();
    // Priced, but no remaining line carries that price.
    expect(
      unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases: [{ quantity: 500, unit: "g", price: 30 }] }),
    ).toBeNull();
    // "1 pcs" of an item kept in grams — no idea how many grams that was.
    expect(
      unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases: [{ quantity: 1, unit: "pcs", price: 24 }] }),
    ).toBeNull();
    // A zero-quantity line would divide into Infinity.
    expect(
      unitPriceFromLastPurchase({ unit: "g", lastKnownPrice: 24, purchases: [{ quantity: 0, unit: "g", price: 24 }] }),
    ).toBeNull();
  });
});

describe("computeRecipeCost", () => {
  it("leaves Don't-track rows out entirely instead of counting them as skipped (MATCH-2)", () => {
    const cost = computeRecipeCost(
      [priced(2, "pcs", "pcs", 10), { untracked: true, quantity: 3, unit: "dl", inventoryItem: null }],
      2,
    );
    expect(cost).toMatchObject({ total: 20, pricedCount: 1, skippedCount: 0 });
  });

  it("prices a gram ingredient from a 500 g pack as a share of the pack, not grams × pack price", () => {
    // The regression this module was fixed for: lastKnownPrice 24 is what a
    // 500 g pack cost, so 200 g is 200 × 24/500 = 9.60, not 200 × 24 = 4800.
    const cost = computeRecipeCost([priced(200, "g", "g", 24, { quantity: 500 })], 1);
    expect(cost).toEqual({ total: 9.6, perServing: 9.6, pricedCount: 1, skippedCount: 0 });
  });

  it("does the same for volume and for multi-piece lines", () => {
    // 1000 ml bought for 15 → 250 ml is 3.75; 12 eggs for 36 → 3 eggs is 9.
    const cost = computeRecipeCost(
      [priced(250, "ml", "ml", 15, { quantity: 1000 }), priced(3, "pcs", "pcs", 36, { quantity: 12 })],
      1,
    );
    expect(cost).toEqual({ total: 12.75, perServing: 12.75, pricedCount: 2, skippedCount: 0 });
  });

  it("sums per-unit prices and splits the total across servings", () => {
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
    // 500 g of an item bought 1 kg at a time for 80 costs 40; 3 tbsp
    // (45 ml) of oil bought 1 l at a time for 100 costs 4.5.
    const cost = computeRecipeCost(
      [priced(500, "g", "kg", 80), priced(3, "tbsp", "l", 100)],
      2,
    );

    expect(cost).toEqual({ total: 44.5, perServing: 22.25, pricedCount: 2, skippedCount: 0 });
  });

  it("skips and counts ingredients that can't be priced honestly", () => {
    const cost = computeRecipeCost(
      [
        priced(1, "pcs", "pcs", 12),
        priced(1, "pcs", "pcs", null), // never priced
        { quantity: 1, unit: "pcs", inventoryItem: null }, // unlinked
        priced(2, "cups", "kg", 30), // volume vs weight — no density
        priced(1, "clove", "pcs", 5), // unrecognized count unit
        priced(200, "g", "g", 24, null), // priced, but the purchase line is gone
        priced(200, "g", "g", 24, { quantity: 1, unit: "pcs" }), // bought as "1 pcs" of a gram item
      ],
      2,
    );

    expect(cost).toEqual({ total: 12, perServing: 6, pricedCount: 1, skippedCount: 6 });
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
