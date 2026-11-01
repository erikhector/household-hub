import { describe, expect, it } from "vitest";
import { getStockStatus } from "./stock-status";
import { canonicalUnit, classifyUnits, convertForItem, defaultLowStockThreshold, convertQuantity, unitLabel, unitLabelForQuantity, unitsAreComparable, withCommonUnits } from "./units";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

describe("convertQuantity", () => {
  it("converts between volume units", () => {
    expect(convertQuantity(1, "l", "tbsp")).toBeCloseTo(66.67, 1);
    expect(convertQuantity(3, "tbsp", "l")).toBeCloseTo(0.045, 3);
    expect(convertQuantity(1, "cup", "ml")).toBeCloseTo(240, 5);
  });

  it("converts between weight units", () => {
    expect(convertQuantity(1, "kg", "g")).toBe(1000);
    expect(convertQuantity(500, "g", "kg")).toBe(0.5);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(convertQuantity(1, " Liters ", "ML")).toBeCloseTo(1000, 5);
  });

  it("returns null across dimensions (volume vs weight)", () => {
    expect(convertQuantity(1, "cup", "g")).toBeNull();
  });

  it("returns null for unrecognized units", () => {
    expect(convertQuantity(1, "cup", "smidgen")).toBeNull();
    expect(convertQuantity(1, "pcs", "clove")).toBeNull();
  });
});

describe("unitsAreComparable", () => {
  it("is true for the exact same unit, regardless of case/whitespace", () => {
    expect(unitsAreComparable("Pcs", " pcs ")).toBe(true);
  });

  it("is true for different but convertible units", () => {
    expect(unitsAreComparable("l", "tbsp")).toBe(true);
  });

  it("is false across dimensions or for unrecognized units", () => {
    expect(unitsAreComparable("cup", "g")).toBe(false);
    expect(unitsAreComparable("clove", "pcs")).toBe(false);
  });
});

describe("canonicalUnit", () => {
  it("maps Swedish and English synonyms onto one spelling", () => {
    expect(canonicalUnit("st")).toBe("pcs");
    expect(canonicalUnit("Piece")).toBe("pcs");
    expect(canonicalUnit(" MSK ")).toBe("tbsp");
    expect(canonicalUnit("tsk")).toBe("tsp");
    expect(canonicalUnit("liter")).toBe("l");
  });

  it("leaves an unknown unit lowercased and trimmed", () => {
    expect(canonicalUnit(" Handful ")).toBe("handful");
  });
});

describe("classifyUnits", () => {
  it("treats synonyms as the same unit", () => {
    expect(classifyUnits("st", "pcs")).toBe("same");
    expect(classifyUnits("msk", "tbsp")).toBe("same");
  });

  it("recognizes a generic conversion", () => {
    expect(classifyUnits("dl", "l")).toBe("convertible");
    expect(classifyUnits("msk", "ml")).toBe("convertible");
  });

  it("can't reconcile count vs measure, different dimensions or unknown units", () => {
    expect(classifyUnits("g", "pcs")).toBe("unknown");
    expect(classifyUnits("dl", "g")).toBe("unknown");
    expect(classifyUnits("handful", "pcs")).toBe("unknown");
  });

  it("is `known` when only the item's saved conversions reconcile it (MATCH-3)", () => {
    const flourBags = [{ fromUnit: "g", factor: 1 / 2000 }];
    expect(classifyUnits("g", "pcs", flourBags)).toBe("known");
    expect(classifyUnits("kg", "pcs", flourBags)).toBe("known");
    expect(classifyUnits("dl", "pcs", flourBags)).toBe("unknown");
    // The generic answer still wins where there is one.
    expect(classifyUnits("st", "pcs", flourBags)).toBe("same");
  });
});

describe("convertForItem (MATCH-3)", () => {
  const flourInPcs = { unit: "pcs" };
  // 1 pcs (a 2 kg bag) = 2000 g, stored the other way round: 1 g = 1/2000 pcs.
  const bag = [{ fromUnit: "g", factor: 1 / 2000 }];

  it("returns the same amount for the same unit, with or without conversions", () => {
    expect(convertForItem(3, "st", flourInPcs)).toBe(3);
    expect(convertForItem(3, "pcs", flourInPcs, bag)).toBe(3);
  });

  it("uses the generic table before any saved conversion", () => {
    // A saved "dl" conversion on a litre item can't override the real
    // 1 dl = 0.1 l.
    expect(convertForItem(2, "dl", { unit: "l" }, [{ fromUnit: "dl", factor: 5 }])).toBeCloseTo(0.2, 10);
  });

  it("applies a saved conversion for exactly that unit", () => {
    expect(convertForItem(300, "g", flourInPcs, bag)).toBeCloseTo(0.15, 10);
  });

  it("matches the saved unit by its canonical spelling", () => {
    expect(convertForItem(2, "Gram", flourInPcs, bag)).toBeCloseTo(0.001, 10);
    expect(convertForItem(3, "st", { unit: "g" }, [{ fromUnit: "pcs", factor: 55 }])).toBe(165);
  });

  it("chains through the generic table into a saved conversion", () => {
    expect(convertForItem(1, "kg", flourInPcs, bag)).toBeCloseTo(0.5, 10);
    // Flour weighed in grams, with 1 dl = 60 g saved: 2 msk = 30 ml = 0.3 dl.
    expect(convertForItem(2, "msk", { unit: "g" }, [{ fromUnit: "dl", factor: 60 }])).toBeCloseTo(18, 10);
  });

  it("refuses a unit no conversion reaches", () => {
    expect(convertForItem(300, "g", flourInPcs)).toBeNull();
    expect(convertForItem(2, "dl", flourInPcs, bag)).toBeNull();
    expect(convertForItem(1, "handful", flourInPcs, bag)).toBeNull();
    expect(convertForItem(1, "clove", flourInPcs, bag)).toBeNull();
  });

  it("ignores a conversion with a factor that isn't a positive number", () => {
    expect(convertForItem(300, "g", flourInPcs, [{ fromUnit: "g", factor: 0 }])).toBeNull();
    expect(convertForItem(300, "g", flourInPcs, [{ fromUnit: "g", factor: -1 }])).toBeNull();
    expect(convertForItem(300, "g", flourInPcs, [{ fromUnit: "g", factor: Number.NaN }])).toBeNull();
    expect(convertForItem(1, "kg", flourInPcs, [{ fromUnit: "g", factor: Infinity }])).toBeNull();
  });

  it("falls back to a usable conversion when a direct one is unusable", () => {
    const conversions = [
      { fromUnit: "g", factor: 0 },
      { fromUnit: "kg", factor: 0.5 },
    ];
    expect(convertForItem(300, "g", flourInPcs, conversions)).toBeCloseTo(0.15, 10);
  });
});

describe("synonym-aware conversion", () => {
  it("converts a synonym 1:1 so comparable units always convert", () => {
    expect(unitsAreComparable("st", "pcs")).toBe(true);
    expect(convertQuantity(3, "st", "pcs")).toBe(3);
  });
});

describe("unitLabel (UX-44)", () => {
  it("shows a known unit in the dictionary's language", () => {
    expect(unitLabel("pcs", sv.units)).toBe("st");
    expect(unitLabel("tbsp", sv.units)).toBe("msk");
    expect(unitLabel("pcs", en.units)).toBe("pcs");
  });

  it("labels synonyms and spellings like their canonical unit", () => {
    expect(unitLabel("st", sv.units)).toBe("st");
    expect(unitLabel("Pieces", sv.units)).toBe("st");
    expect(unitLabel(" Tablespoon ", sv.units)).toBe("msk");
    expect(unitLabel("förp", en.units)).toBe("pack");
  });

  it("falls back to the stored text for an unknown unit", () => {
    expect(unitLabel("Glug", sv.units)).toBe("Glug");
    expect(unitLabel("constructor", sv.units)).toBe("constructor");
    expect(unitLabel("", sv.units)).toBe("");
  });

  it("has a label for every canonical unit the app recognises", () => {
    for (const unit of ["pcs", "clove", "can", "pack", "slice", "bunch", "jar", "bag", "bottle", "box", "tsp", "tbsp", "krm", "pinch", "ml", "l", "g", "kg"]) {
      expect(sv.units).toHaveProperty(unit);
      expect(en.units).toHaveProperty(unit);
    }
  });
});

describe("defaultLowStockThreshold", () => {
  it("is 1 for whole pieces, never above the default quantity of 1 (UX-156)", () => {
    expect(defaultLowStockThreshold("pcs")).toBe("1");
    expect(defaultLowStockThreshold("st")).toBe("1");
    // A freshly added default item must not read as low.
    expect(getStockStatus(1, Number(defaultLowStockThreshold("pcs")))).toBe("in");
  });

  it("is empty for weights, volumes and unknown units", () => {
    expect(defaultLowStockThreshold("g")).toBe("");
    expect(defaultLowStockThreshold("ml")).toBe("");
    expect(defaultLowStockThreshold("bunch of keys")).toBe("");
  });
});

describe("unitLabelForQuantity (UX-98)", () => {
  it("pluralises count words above one and keeps one and fractions singular", () => {
    expect(unitLabelForQuantity("clove", 3, en.units, en.unitsPlural)).toBe("cloves");
    expect(unitLabelForQuantity("clove", 1, en.units, en.unitsPlural)).toBe("clove");
    expect(unitLabelForQuantity("cup", 0.5, en.units, en.unitsPlural)).toBe("cup");
    expect(unitLabelForQuantity("klyfta", 2, sv.units, sv.unitsPlural)).toBe("klyftor");
  });

  it("leaves units that have no distinct plural alone", () => {
    expect(unitLabelForQuantity("g", 200, en.units, en.unitsPlural)).toBe("g");
    expect(unitLabelForQuantity("pcs", 4, sv.units, sv.unitsPlural)).toBe("st");
    expect(unitLabelForQuantity("Glug", 4, en.units, en.unitsPlural)).toBe("Glug");
  });
});

describe("withCommonUnits", () => {
  it("gives a new household the common units", () => {
    expect(withCommonUnits([])).toEqual(["pcs", "g", "kg", "dl", "l", "förp"]);
  });
  it("lists the household's own units after them, once each", () => {
    expect(withCommonUnits(["g", "bunch", "st"])).toEqual(["pcs", "g", "kg", "dl", "l", "förp", "bunch", "st"]);
  });
});
