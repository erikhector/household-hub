import { describe, expect, it } from "vitest";
import {
  conversionProblem,
  conversionSentence,
  factorFromSentence,
  planUnitChange,
  suggestedUnitChangeFactor,
  usedInRows,
} from "@/lib/inventory/item-units";

const flour = { unit: "pcs" };
const flourConversions = [{ fromUnit: "g", factor: 0.0005 }];

describe("usedInRows", () => {
  it("restates each recipe amount in the item's unit, ⚠ (null) when it can't", () => {
    const rows = usedInRows(
      [
        { id: "a", recipeId: "r2", recipeName: "Sockerkaka", quantity: 2, unit: "cup" },
        { id: "b", recipeId: "r1", recipeName: "Kanelbullar", quantity: 750, unit: "g" },
        { id: "c", recipeId: "r3", recipeName: "Pizzadeg", quantity: 1, unit: "kg" },
        { id: "d", recipeId: "r4", recipeName: "Bröd", quantity: 2, unit: "st" },
      ],
      flour,
      flourConversions,
    );

    expect(rows.map((row) => [row.recipeName, row.converted])).toEqual([
      ["Bröd", 2],
      ["Kanelbullar", 0.375],
      // Through the generic table first: kg → g → pcs.
      ["Pizzadeg", 0.5],
      ["Sockerkaka", null],
    ]);
  });
});

describe("conversionSentence / factorFromSentence", () => {
  it("reads a count item's conversion with the item's unit first", () => {
    expect(conversionSentence("g", 0.0005, "pcs")).toEqual({ leadUnit: "pcs", amount: 2000, otherUnit: "g" });
    expect(factorFromSentence("g", "pcs", "2000")).toBe(0.0005);
  });

  it("reads a density with the recipe's unit first", () => {
    expect(conversionSentence("dl", 60, "g")).toEqual({ leadUnit: "dl", amount: 60, otherUnit: "g" });
    expect(factorFromSentence("dl", "g", "60,5")).toBe(60.5);
  });

  it("refuses empty, non-positive and out-of-range amounts", () => {
    expect(factorFromSentence("dl", "g", "")).toBeNull();
    expect(factorFromSentence("dl", "g", "0")).toBeNull();
    expect(factorFromSentence("dl", "g", "-1")).toBeNull();
    expect(factorFromSentence("dl", "g", "abc")).toBeNull();
    expect(factorFromSentence("dl", "g", "2000000")).toBeNull();
  });
});

describe("conversionProblem", () => {
  it("refuses the item's own unit, a generic one and an empty one", () => {
    expect(conversionProblem("st", "pcs")).toBe("ownUnit");
    expect(conversionProblem("kg", "g")).toBe("generic");
    expect(conversionProblem("  ", "g")).toBe("empty");
    expect(conversionProblem("dl", "g")).toBeNull();
  });
});

describe("planUnitChange", () => {
  const item = {
    unit: "pcs",
    quantity: 1,
    lowStockThreshold: 0.5,
    conversions: [
      { fromUnit: "g", factor: 0.0005 },
      { fromUnit: "dl", factor: 0.03 },
      { fromUnit: "cup", factor: 0.07 },
    ],
  };

  it("converts stock and threshold and re-expresses every conversion", () => {
    const result = planUnitChange(item, "g", 2000);
    expect(result).toEqual({
      plan: {
        unit: "g",
        quantity: 2000,
        lowStockThreshold: 1000,
        conversions: [
          // "1 g = 0.0005 pcs" is from the new unit itself: dropped.
          { fromUnit: "dl", factor: 60 },
          { fromUnit: "cup", factor: 140 },
          // The old unit is kept as a conversion.
          { fromUnit: "pcs", factor: 2000 },
        ],
      },
    });
  });

  it("drops a conversion the generic table converts into the new unit", () => {
    const result = planUnitChange(item, "kg", 2);
    expect("plan" in result && result.plan.conversions.map((conversion) => conversion.fromUnit)).toEqual([
      "dl",
      "cup",
      "pcs",
    ]);
    const toLitres = planUnitChange(item, "l", 1.6);
    expect("plan" in toLitres && toLitres.plan.conversions.map((conversion) => conversion.fromUnit)).toEqual([
      "g",
      "pcs",
    ]);
  });

  it("rounds away float drift without losing small amounts", () => {
    const result = planUnitChange({ unit: "l", quantity: 0.3, lowStockThreshold: 0, conversions: [] }, "dl", 10);
    expect("plan" in result && result.plan.quantity).toBe(3);
    const grams = planUnitChange({ unit: "g", quantity: 5, lowStockThreshold: 0, conversions: [] }, "kg", 0.001);
    expect("plan" in grams && grams.plan.quantity).toBe(0.005);
  });

  it("refuses the same unit, an empty one, a bad factor and a conversion pushed out of range", () => {
    expect(planUnitChange(item, "st", 1)).toEqual({ problem: "sameUnit" });
    expect(planUnitChange(item, " ", 1)).toEqual({ problem: "emptyUnit" });
    expect(planUnitChange(item, "g", 0)).toEqual({ problem: "factor" });
    expect(planUnitChange(item, "g", Number.NaN)).toEqual({ problem: "factor" });
    expect(
      planUnitChange({ ...item, conversions: [{ fromUnit: "dl", factor: 1000 }] }, "mg", 1_000_000),
    ).toEqual({ problem: "conversionRange" });
  });
});

describe("suggestedUnitChangeFactor", () => {
  it("uses the generic table, then a saved conversion from the new unit", () => {
    expect(suggestedUnitChangeFactor("l", "dl", [])).toBe(10);
    expect(suggestedUnitChangeFactor("pcs", "g", flourConversions)).toBe(2000);
    expect(suggestedUnitChangeFactor("pcs", "kg", flourConversions)).toBe(2);
    expect(suggestedUnitChangeFactor("pcs", "cup", flourConversions)).toBeNull();
    expect(suggestedUnitChangeFactor("pcs", "", flourConversions)).toBeNull();
  });
});
