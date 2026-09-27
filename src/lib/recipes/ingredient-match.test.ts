import { describe, expect, it } from "vitest";
import {
  defaultNewItemUnit,
  ingredientBaseName,
  ingredientNeedsReview,
  matchIngredientRows,
  type IngredientMatchItem,
} from "./ingredient-match";

const pantry: IngredientMatchItem[] = [
  { id: "egg", name: "Egg", unit: "pcs" },
  { id: "tomatoes", name: "Tomatoes", unit: "pcs" },
  { id: "milk", name: "Mjölk", unit: "l" },
  { id: "flour", name: "Vetemjöl", unit: "pcs" },
  { id: "onion", name: "Gul lök", unit: "pcs" },
];

const matchOne = (name: string, unit = "pcs", items = pantry, linkedItemId?: string) =>
  matchIngredientRows([{ name, unit, linkedItemId }], items)[0];

describe("matchIngredientRows", () => {
  it("is confident about an exact name, ignoring case and punctuation", () => {
    const match = matchOne("egg.");
    expect(match).toMatchObject({ status: "confident", itemId: "egg", source: "exact", unitClass: "same" });
    expect(ingredientNeedsReview(match)).toBe(false);
  });

  it("ignores a trailing parenthesized prep note", () => {
    expect(matchOne("gul lök (finhackad)")).toMatchObject({ status: "confident", itemId: "onion" });
  });

  it("suggests a singular item for an English plural", () => {
    expect(matchOne("eggs")).toMatchObject({ status: "suggested", itemId: "egg", source: "plural" });
  });

  it("suggests for a Swedish plural too", () => {
    const items = [{ id: "tomat", name: "Tomat", unit: "pcs" }];
    expect(matchOne("tomater", "pcs", items)).toMatchObject({ status: "suggested", itemId: "tomat" });
  });

  it("never confidently links through a fold that only looks like a plural", () => {
    // "creamer" folds to "cream" via -er: a different product, so the
    // row must be reviewed even though the units convert.
    const items = [{ id: "creamer", name: "Creamer", unit: "l" }];
    const match = matchOne("cream", "dl", items);
    expect(match).toMatchObject({ status: "suggested", itemId: "creamer", source: "plural" });
    expect(ingredientNeedsReview(match)).toBe(true);
  });

  it("leaves a fold that hits two items open", () => {
    const items = [
      { id: "a", name: "Carrot", unit: "pcs" },
      { id: "b", name: "Carrots", unit: "pcs" },
    ];
    // "carrotes" folds to "carrot", which both items also fold to.
    expect(matchOne("carrotes", "pcs", items).status).toBe("suggested");
  });

  it("only suggests a softer fuzzy match, with the best guess pre-selected", () => {
    const match = matchOne("Tomater");
    expect(match).toMatchObject({ status: "suggested", itemId: "tomatoes", source: "fuzzy" });
    expect(match.candidateIds[0]).toBe("tomatoes");
    expect(ingredientNeedsReview(match)).toBe(true);
  });

  it("isn't confident about a strong fuzzy match without a clear margin", () => {
    const items = [
      { id: "a", name: "Olive oil extra", unit: "l" },
      { id: "b", name: "Olive oil extra.", unit: "l" },
    ];
    // Both normalize to the same name: a genuine choice, never auto-picked.
    expect(matchOne("olive oil extra", "l", items)).toMatchObject({ status: "suggested", itemId: "a" });
  });

  it("returns no suggestion when nothing is close", () => {
    expect(matchOne("Saffron")).toMatchObject({ status: "none", itemId: null, unitClass: null });
  });

  it("keeps an existing link even when the name alone would match something else", () => {
    const match = matchOne("Egg", "pcs", pantry, "tomatoes");
    expect(match).toMatchObject({ status: "confident", itemId: "tomatoes", source: "linked" });
  });

  it("re-matches when the linked item no longer exists", () => {
    expect(matchOne("Egg", "pcs", pantry, "deleted")).toMatchObject({ itemId: "egg", source: "exact" });
  });

  it("classifies the unit against the matched item", () => {
    expect(matchOne("Egg", "st").unitClass).toBe("same");
    expect(matchOne("Mjölk", "dl").unitClass).toBe("convertible");
    expect(matchOne("Vetemjöl", "g").unitClass).toBe("unknown");
  });

  it("sends a confident name with an unknown unit to review, unless it was linked before", () => {
    expect(ingredientNeedsReview(matchOne("Vetemjöl", "g"))).toBe(true);
    expect(ingredientNeedsReview(matchOne("Vetemjöl", "g", pantry, "flour"))).toBe(false);
  });

  it("keeps row indexes in input order", () => {
    const matches = matchIngredientRows(
      [
        { name: "Egg", unit: "pcs" },
        { name: "Saffron", unit: "g" },
      ],
      pantry,
    );
    expect(matches.map((match) => match.rowIndex)).toEqual([0, 1]);
  });
});

describe("ingredientBaseName", () => {
  it("strips only a trailing parenthesized part", () => {
    expect(ingredientBaseName("gul lök (finhackad)")).toBe("gul lök");
    expect(ingredientBaseName("(ekologisk) mjölk")).toBe("(ekologisk) mjölk");
    expect(ingredientBaseName("salt")).toBe("salt");
  });

  it("keeps the name when it's nothing but parentheses", () => {
    expect(ingredientBaseName("(salt)")).toBe("(salt)");
  });
});

describe("defaultNewItemUnit", () => {
  it("keeps a count unit, canonicalized", () => {
    expect(defaultNewItemUnit("st")).toBe("pcs");
    expect(defaultNewItemUnit("klyftor")).toBe("clove");
  });

  it("stocks volumes in litres and weights in grams", () => {
    expect(defaultNewItemUnit("dl")).toBe("l");
    expect(defaultNewItemUnit("cup")).toBe("l");
    expect(defaultNewItemUnit("kg")).toBe("g");
  });

  it("counts spoon measures and unknown units in pieces", () => {
    expect(defaultNewItemUnit("tsk")).toBe("pcs");
    expect(defaultNewItemUnit("krm")).toBe("pcs");
    expect(defaultNewItemUnit("nypa")).toBe("pcs");
    expect(defaultNewItemUnit("handful")).toBe("pcs");
  });
});
