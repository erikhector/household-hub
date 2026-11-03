import { describe, expect, it } from "vitest";
import { normalizeFreeformIngredients, parseFreeformIngredients } from "./custom-meal-ingredients";

describe("normalizeFreeformIngredients (GAP-58)", () => {
  it("trims lines and drops blank ones", () => {
    expect(normalizeFreeformIngredients("  2 tortillas \r\n\n \nsalsa\n")).toBe("2 tortillas\nsalsa");
  });

  it("is null when nothing is left", () => {
    expect(normalizeFreeformIngredients(" \n ")).toBeNull();
    expect(normalizeFreeformIngredients(undefined)).toBeNull();
  });
});

describe("parseFreeformIngredients (GAP-58)", () => {
  it("reads quantity, unit and name like the smart add line", () => {
    expect(parseFreeformIngredients("2 tortillas\n500 g mince\nsalsa")).toEqual([
      { name: "tortillas", quantity: 2, unit: "pcs" },
      { name: "mince", quantity: 500, unit: "g" },
      { name: "salsa", quantity: 1, unit: "pcs" },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseFreeformIngredients(null)).toEqual([]);
    expect(parseFreeformIngredients("")).toEqual([]);
  });
});
