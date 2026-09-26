import { describe, expect, it } from "vitest";
import {
  RECIPE_TAGS,
  isRecipeTag,
  parseRecipeTags,
  recipeMatchesTag,
  tagsFromSchemaOrgDiet,
} from "@/lib/recipe-tags";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

describe("parseRecipeTags", () => {
  it("keeps known tags", () => {
    expect(parseRecipeTags(["vegan", "quick"])).toEqual(["vegan", "quick"]);
  });

  it("drops unknown values and non-strings instead of rejecting", () => {
    expect(parseRecipeTags(["vegetarian", "keto", "", 42, null, { tag: "vegan" }])).toEqual(["vegetarian"]);
  });

  it("dedupes and returns tags in canonical order regardless of input order", () => {
    expect(parseRecipeTags(["quick", "glutenFree", "quick", "vegan"])).toEqual(["vegan", "glutenFree", "quick"]);
  });

  it("trims surrounding whitespace but is otherwise exact (case-sensitive keys)", () => {
    expect(parseRecipeTags([" dairyFree ", "DairyFree", "GLUTENFREE"])).toEqual(["dairyFree"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseRecipeTags([])).toEqual([]);
  });

  it("stops reading after a bounded number of raw values", () => {
    const junk = Array.from({ length: 500 }, () => "nope");
    expect(parseRecipeTags([...junk, "vegan"])).toEqual([]);
  });
});

describe("isRecipeTag", () => {
  it("accepts only members of the closed set", () => {
    expect(isRecipeTag("nutFree")).toBe(true);
    expect(isRecipeTag("paleo")).toBe(false);
    expect(isRecipeTag(undefined)).toBe(false);
  });
});

describe("recipeMatchesTag", () => {
  it("matches a directly tagged recipe", () => {
    expect(recipeMatchesTag(["glutenFree"], "glutenFree")).toBe(true);
    expect(recipeMatchesTag(["glutenFree"], "quick")).toBe(false);
  });

  it("treats vegan as implying vegetarian and dairy-free", () => {
    expect(recipeMatchesTag(["vegan"], "vegetarian")).toBe(true);
    expect(recipeMatchesTag(["vegan"], "dairyFree")).toBe(true);
    expect(recipeMatchesTag(["vegan"], "glutenFree")).toBe(false);
  });

  it("doesn't run implications backwards", () => {
    expect(recipeMatchesTag(["vegetarian", "dairyFree"], "vegan")).toBe(false);
  });
});

describe("tagsFromSchemaOrgDiet", () => {
  it("maps bare enum names and full schema.org URLs", () => {
    expect(tagsFromSchemaOrgDiet("VeganDiet")).toEqual(["vegan"]);
    expect(
      tagsFromSchemaOrgDiet(["https://schema.org/GlutenFreeDiet", "http://schema.org/VegetarianDiet"]),
    ).toEqual(["vegetarian", "glutenFree"]);
  });

  it("ignores diets with no clean tag equivalent and junk values", () => {
    expect(
      tagsFromSchemaOrgDiet(["https://schema.org/LowLactoseDiet", "HalalDiet", { "@id": "VeganDiet" }, 7]),
    ).toEqual([]);
    expect(tagsFromSchemaOrgDiet(undefined)).toEqual([]);
  });
});

describe("dictionary labels", () => {
  it("has a non-empty label for every tag in both locales", () => {
    for (const tag of RECIPE_TAGS) {
      expect(en.mealPlanning.recipeTags[tag]).toBeTruthy();
      expect(sv.mealPlanning.recipeTags[tag]).toBeTruthy();
    }
  });
});
