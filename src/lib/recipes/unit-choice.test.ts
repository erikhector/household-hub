import { describe, expect, it } from "vitest";
import { rowUnitChoice, type UnitChoiceItem, type UnitChoiceRow } from "./unit-choice";

const items: UnitChoiceItem[] = [
  { id: "flour", name: "Vetemjöl", unit: "pcs" },
  { id: "flour-g", name: "Vetemjöl", unit: "g" },
  { id: "egg", name: "Egg", unit: "pcs" },
  { id: "bagged", name: "Rågmjöl", unit: "pcs", conversions: [{ fromUnit: "g", factor: 0.0005 }] },
  { id: "saffron", name: "Saffron", unit: "pcs" },
];

const row = (patch: Partial<UnitChoiceRow>): UnitChoiceRow => ({
  mode: "existing",
  selectedId: "saffron",
  newName: "",
  newUnit: "",
  unit: "g",
  quantity: 300,
  needsReview: true,
  unitAction: null,
  rememberValue: null,
  overrideValue: null,
  ...patch,
});

describe("rowUnitChoice (MATCH-3)", () => {
  it("has nothing to choose when the units reconcile", () => {
    expect(rowUnitChoice(row({ selectedId: "flour-g", unit: "kg" }), items)).toMatchObject({
      unitClass: "convertible",
      action: "none",
    });
    expect(rowUnitChoice(row({ selectedId: "bagged" }), items)).toMatchObject({ unitClass: "known", action: "none" });
  });

  it("defaults to deciding when cooking, with empty fields, when there's no hint", () => {
    expect(rowUnitChoice(row({}), items)).toMatchObject({
      unitClass: "unknown",
      action: "defer",
      leadUnit: "pcs",
      otherUnit: "g",
      rememberValue: "",
      overrideValue: "",
      factor: null,
    });
  });

  it("pre-selects Remember with the ≈ hint, read the natural way round", () => {
    // Flour weighed in grams, recipe in dl: "1 dl ≈ 60 g".
    const choice = rowUnitChoice(row({ selectedId: "flour-g", unit: "dl", quantity: 3 }), items);
    expect(choice).toMatchObject({
      action: "remember",
      fromHint: true,
      leadUnit: "dl",
      otherUnit: "g",
      rememberValue: "60",
      factor: 60,
      overrideValue: "180",
    });
  });

  it("stores the factor per recipe unit when the item's unit leads", () => {
    // "1 pcs = 2000 g" typed for flour counted in bags → 1 g = 0.0005 pcs.
    const choice = rowUnitChoice(row({ selectedId: "flour", unitAction: "remember", rememberValue: "2000" }), items);
    expect(choice).toMatchObject({ leadUnit: "pcs", otherUnit: "g", fromHint: false });
    expect(choice.factor).toBeCloseTo(0.0005, 10);
  });

  it("accepts a decimal comma", () => {
    const choice = rowUnitChoice(row({ unitAction: "override", overrideValue: "0,15" }), items);
    expect(choice).toMatchObject({ action: "override", overrideQuantity: 0.15 });
  });

  it("rejects an amount that isn't a positive number", () => {
    for (const value of ["", "0", "-1", "abc"]) {
      expect(rowUnitChoice(row({ unitAction: "remember", rememberValue: value }), items).factor).toBeNull();
      expect(rowUnitChoice(row({ unitAction: "override", overrideValue: value }), items).overrideQuantity).toBeNull();
    }
  });

  it("never pre-selects Remember on a row nobody is asked to look at", () => {
    const choice = rowUnitChoice(row({ selectedId: "egg", unit: "g", needsReview: false }), items);
    expect(choice).toMatchObject({ unitClass: "unknown", action: "defer" });
  });

  it("uses the new item's name and unit for a Create new row", () => {
    const choice = rowUnitChoice(row({ mode: "new", newName: "Ägg", newUnit: "g", unit: "st", quantity: 3 }), items);
    expect(choice).toMatchObject({
      pantryUnit: "g",
      unitClass: "unknown",
      action: "remember",
      rememberValue: "55",
      overrideValue: "165",
    });
  });

  it("has no unit to compare for a Don't-track row", () => {
    expect(rowUnitChoice(row({ mode: "untracked" }), items)).toMatchObject({ unitClass: null, action: "none" });
  });
});
