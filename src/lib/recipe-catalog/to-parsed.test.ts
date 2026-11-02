import { describe, expect, it } from "vitest";
import { catalogToParsedRecipe } from "./to-parsed";
import type { CatalogRecipe } from "./types";

const recipe: CatalogRecipe = {
  id: "x",
  name: { en: "Soup", sv: "Soppa" },
  servings: 3,
  ingredients: [
    { name: { en: "milk", sv: "mjölk" }, quantity: 2, unit: "dl" },
    { name: { en: "egg", sv: "ägg" }, quantity: 2, unit: "pcs" },
    {
      name: { en: "yellow onion", sv: "gul lök" },
      quantity: 1,
      unit: "pcs",
      note: { en: "finely chopped", sv: "finhackad" },
    },
    { name: { en: "butter", sv: "smör" }, quantity: 0.5, unit: "dl" },
  ],
  instructions: { en: "Cook it.", sv: "Laga det." },
  tags: ["vegetarian"],
};

describe("catalogToParsedRecipe", () => {
  it("picks the locale's text", () => {
    const en = catalogToParsedRecipe(recipe, "en");
    expect(en.name).toBe("Soup");
    expect(en.instructions).toBe("Cook it.");
    expect(en.ingredients[2]).toMatchObject({ name: "yellow onion", note: "finely chopped" });
    const sv = catalogToParsedRecipe(recipe, "sv");
    expect(sv.name).toBe("Soppa");
    expect(sv.instructions).toBe("Laga det.");
    expect(sv.ingredients[2]).toMatchObject({ name: "gul lök", note: "finhackad" });
  });

  it("builds rawText as the display line", () => {
    const { ingredients } = catalogToParsedRecipe(recipe, "en");
    expect(ingredients[0].rawText).toBe("2 dl milk");
    expect(ingredients[1].rawText).toBe("2 egg");
    expect(ingredients[2].rawText).toBe("1 yellow onion, finely chopped");
    expect(ingredients[3].rawText).toBe("0.5 dl butter");
  });

  it("keeps the pcs unit and omits note when absent", () => {
    const { ingredients } = catalogToParsedRecipe(recipe, "en");
    expect(ingredients[1].unit).toBe("pcs");
    expect("note" in ingredients[1]).toBe(false);
  });

  it("carries servings and tags", () => {
    const out = catalogToParsedRecipe(recipe, "en");
    expect(out.servings).toBe(3);
    expect(out.tags).toEqual(["vegetarian"]);
  });
});
