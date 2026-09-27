import { describe, expect, it } from "vitest";
import { conversionLeadUnit, unitConversionHint } from "./unit-hints";

describe("unitConversionHint (MATCH-3)", () => {
  it("turns a density into a factor between volume and weight", () => {
    // Flour ≈ 0.6 g/ml: 1 dl ≈ 60 g.
    expect(unitConversionHint("Vetemjöl", "dl", "g")).toBeCloseTo(60, 10);
    expect(unitConversionHint("flour", "g", "dl")).toBeCloseTo(1 / 60, 10);
    expect(unitConversionHint("Socker", "msk", "kg")).toBeCloseTo(0.01275, 10);
  });

  it("turns a piece weight into a factor between count and weight", () => {
    expect(unitConversionHint("Eggs", "st", "g")).toBe(55);
    expect(unitConversionHint("gul lök", "g", "pcs")).toBeCloseTo(1 / 150, 10);
  });

  it("has nothing when the hint doesn't cover one side", () => {
    // Flour has a density, but no piece weight: a "piece" of flour is
    // whatever bag the household buys.
    expect(unitConversionHint("flour", "g", "pcs")).toBeNull();
    // Egg has a piece weight, but no density.
    expect(unitConversionHint("egg", "dl", "pcs")).toBeNull();
    expect(unitConversionHint("egg", "handful", "g")).toBeNull();
  });

  it("has nothing for an item that isn't a listed staple", () => {
    expect(unitConversionHint("Saffron", "g", "pcs")).toBeNull();
  });

  it("has nothing when the generic table already converts", () => {
    expect(unitConversionHint("flour", "kg", "g")).toBeNull();
    expect(unitConversionHint("egg", "st", "pcs")).toBeNull();
  });
});

describe("conversionLeadUnit (MATCH-3)", () => {
  it("leads with the item's unit when the pantry counts it", () => {
    expect(conversionLeadUnit("g", "pcs")).toBe("item");
    expect(conversionLeadUnit("dl", "pack")).toBe("item");
  });

  it("leads with a volume against a weight", () => {
    expect(conversionLeadUnit("dl", "g")).toBe("recipe");
    expect(conversionLeadUnit("g", "l")).toBe("item");
  });

  it("otherwise leads with the recipe's unit", () => {
    expect(conversionLeadUnit("st", "g")).toBe("recipe");
    expect(conversionLeadUnit("handful", "g")).toBe("recipe");
  });
});
