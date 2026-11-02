import { describe, expect, it } from "vitest";
import { parseRecipeTags } from "@/lib/recipe-tags";
import { unitKind } from "@/lib/units";
import { RECIPE_CATALOG } from "./data";
import { FEATURED_COUNT } from "./types";

const MIN_RECIPES = 120;
const LANGS = ["en", "sv"] as const;
// The metric units the catalog sticks to, so recipes scale and convert cleanly.
const CATALOG_UNITS = new Set(["g", "kg", "dl", "l", "ml", "msk", "tsk", "krm", "pcs"]);

describe("recipe catalog", () => {
  it("ids are unique kebab-case", () => {
    const ids = RECIPE_CATALOG.map((r) => r.id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least MIN_RECIPES recipes", () => {
    expect(RECIPE_CATALOG.length).toBeGreaterThanOrEqual(MIN_RECIPES);
  });

  it("every localized field is filled in both languages", () => {
    for (const r of RECIPE_CATALOG) {
      for (const lang of LANGS) {
        expect(r.name[lang].trim(), `${r.id} name ${lang}`).not.toBe("");
        expect(r.instructions[lang].trim(), `${r.id} instructions ${lang}`).not.toBe("");
        expect(r.ingredients.length, `${r.id} ingredients`).toBeGreaterThan(0);
        for (const i of r.ingredients) {
          expect(i.name[lang].trim(), `${r.id} ingredient ${lang}`).not.toBe("");
          if (i.note) expect(i.note[lang].trim(), `${r.id} note ${lang}`).not.toBe("");
        }
      }
    }
  });

  it("tags come from RECIPE_TAGS", () => {
    for (const r of RECIPE_CATALOG) expect(parseRecipeTags(r.tags), r.id).toEqual(r.tags);
  });

  it("units are known", () => {
    for (const r of RECIPE_CATALOG)
      for (const i of r.ingredients) {
        expect(unitKind(i.unit), `${r.id} ${i.unit}`).not.toBeNull();
        expect(CATALOG_UNITS.has(i.unit), `${r.id} ${i.unit}`).toBe(true);
      }
  });

  it("quantities and servings are sane", () => {
    for (const r of RECIPE_CATALOG) {
      expect(r.servings, r.id).toBeGreaterThanOrEqual(1);
      expect(r.servings, r.id).toBeLessThanOrEqual(12);
      for (const i of r.ingredients) {
        expect(Number.isFinite(i.quantity), r.id).toBe(true);
        expect(i.quantity, r.id).toBeGreaterThan(0);
      }
    }
  });

  it("names are unique per language", () => {
    for (const lang of LANGS) {
      const names = RECIPE_CATALOG.map((r) => r.name[lang].trim().toLowerCase());
      expect(new Set(names).size, lang).toBe(names.length);
    }
  });

  it("instructions have one step per line", () => {
    for (const r of RECIPE_CATALOG)
      for (const lang of LANGS)
        expect(r.instructions[lang].split("\n").length, `${r.id} ${lang}`).toBeGreaterThanOrEqual(2);
  });

  it("has enough vegetarian or vegan recipes", () => {
    expect(
      RECIPE_CATALOG.filter((r) => r.tags.includes("vegetarian") || r.tags.includes("vegan")).length,
    ).toBeGreaterThanOrEqual(25);
  });

  it("has enough quick recipes", () => {
    expect(RECIPE_CATALOG.filter((r) => r.tags.includes("quick")).length).toBeGreaterThanOrEqual(15);
  });

  it("the featured set is varied", () => {
    const featured = RECIPE_CATALOG.slice(0, FEATURED_COUNT);
    expect(
      featured.filter((r) => r.tags.includes("vegetarian") || r.tags.includes("vegan")).length,
    ).toBeGreaterThanOrEqual(3);
    expect(featured.filter((r) => r.tags.includes("quick")).length).toBeGreaterThanOrEqual(3);
    const fish = /lax|torsk|sill|fisk|salmon|cod|herring|fish/i;
    expect(featured.filter((r) => fish.test(r.id)).length).toBeGreaterThanOrEqual(2);
  });
});
