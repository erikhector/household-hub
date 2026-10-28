import { describe, expect, it } from "vitest";
import { extractJsonLdBlocks, findRecipeNode, flattenInstructions, mapJsonLdToRecipe } from "./parse-jsonld";

describe("extractJsonLdBlocks", () => {
  it("extracts a single ld+json script block", () => {
    const html = `<html><head><script type="application/ld+json">{"a":1}</script></head></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([`{"a":1}`]);
  });

  it("extracts multiple blocks", () => {
    const html = `
      <script type="application/ld+json">{"a":1}</script>
      <p>hi</p>
      <script type="application/ld+json">{"b":2}</script>
    `;
    expect(extractJsonLdBlocks(html)).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("matches attribute order/quoting variations", () => {
    const html = `<script id="x" type='application/ld+json'>{"a":1}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([`{"a":1}`]);
  });

  it("matches an unquoted type attribute (e.g. Yoast SEO on WordPress)", () => {
    const html = `<script type=application/ld+json class=yoast-schema-graph>{"a":1}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([`{"a":1}`]);
  });

  it("does not match an unquoted attribute value that merely starts with the type", () => {
    const html = `<script type=application/ld+jsonish>{"a":1}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([]);
  });

  it("returns an empty array when there are no ld+json blocks", () => {
    expect(extractJsonLdBlocks("<html><body>no scripts here</body></html>")).toEqual([]);
  });

  it("ignores scripts of other types", () => {
    const html = `<script type="application/javascript">var a = 1;</script>`;
    expect(extractJsonLdBlocks(html)).toEqual([]);
  });
});

describe("findRecipeNode", () => {
  it("finds a plain Recipe object", () => {
    const block = JSON.stringify({ "@type": "Recipe", name: "Soup" });
    expect(findRecipeNode([block])).toEqual({ "@type": "Recipe", name: "Soup" });
  });

  it("finds a Recipe whose @type is an array", () => {
    const block = JSON.stringify({ "@type": ["Recipe", "Thing"], name: "Soup" });
    const found = findRecipeNode([block]);
    expect(found?.name).toBe("Soup");
  });

  it("finds a Recipe nested inside an @graph array", () => {
    const block = JSON.stringify({
      "@graph": [{ "@type": "WebPage" }, { "@type": "Recipe", name: "Stew" }],
    });
    const found = findRecipeNode([block]);
    expect(found?.name).toBe("Stew");
  });

  it("finds a Recipe inside a top-level array", () => {
    const block = JSON.stringify([{ "@type": "Organization" }, { "@type": "Recipe", name: "Cake" }]);
    const found = findRecipeNode([block]);
    expect(found?.name).toBe("Cake");
  });

  it("returns null when no block contains a Recipe", () => {
    const block = JSON.stringify({ "@type": "WebPage" });
    expect(findRecipeNode([block])).toBeNull();
  });

  it("skips unparsable blocks without throwing", () => {
    expect(findRecipeNode(["{not valid json"])).toBeNull();
  });

  it("recovers a Recipe from an HTML-entity-escaped block", () => {
    const block = `{&quot;@type&quot;:&quot;Recipe&quot;,&quot;name&quot;:&quot;Soup&quot;}`;
    const found = findRecipeNode([block]);
    expect(found?.name).toBe("Soup");
  });

  it("checks later blocks when an earlier one has no Recipe", () => {
    const blocks = [JSON.stringify({ "@type": "WebPage" }), JSON.stringify({ "@type": "Recipe", name: "Pie" })];
    expect(findRecipeNode(blocks)?.name).toBe("Pie");
  });
});


describe("flattenInstructions", () => {
  it("returns a plain string unchanged (trimmed)", () => {
    expect(flattenInstructions("  Mix everything.  ")).toBe("Mix everything.");
  });

  it("joins an array of strings with newlines", () => {
    expect(flattenInstructions(["Step one.", "Step two."])).toBe("Step one.\nStep two.");
  });

  it("flattens an array of HowToStep objects", () => {
    const steps = [
      { "@type": "HowToStep", text: "Preheat oven." },
      { "@type": "HowToStep", text: "Bake for 20 minutes." },
    ];
    expect(flattenInstructions(steps)).toBe("Preheat oven.\nBake for 20 minutes.");
  });

  it("flattens a HowToSection with nested HowToStep items", () => {
    const sections = [
      {
        "@type": "HowToSection",
        name: "Prep",
        itemListElement: [
          { "@type": "HowToStep", text: "Chop onions." },
          { "@type": "HowToStep", text: "Boil water." },
        ],
      },
    ];
    expect(flattenInstructions(sections)).toBe("Chop onions.\nBoil water.");
  });

  it("returns an empty string for null/undefined", () => {
    expect(flattenInstructions(null)).toBe("");
    expect(flattenInstructions(undefined)).toBe("");
  });

  it("skips array entries it can't flatten", () => {
    expect(flattenInstructions(["Step one.", {}, "Step two."])).toBe("Step one.\nStep two.");
  });
});

describe("mapJsonLdToRecipe", () => {
  it("maps name, ingredients, and instructions from a full Recipe node", () => {
    const node = {
      "@type": "Recipe",
      name: "Tomato Soup",
      recipeIngredient: ["2 cups tomatoes", "1 tbsp olive oil", "salt to taste"],
      recipeInstructions: [
        { "@type": "HowToStep", text: "Simmer tomatoes." },
        { "@type": "HowToStep", text: "Blend until smooth." },
      ],
    };
    expect(mapJsonLdToRecipe(node)).toEqual({
      name: "Tomato Soup",
      instructions: "Simmer tomatoes.\nBlend until smooth.",
      ingredients: [
        { name: "tomatoes", quantity: 2, unit: "cups", rawText: "2 cups tomatoes" },
        { name: "olive oil", quantity: 1, unit: "tbsp", rawText: "1 tbsp olive oil" },
        { name: "salt to taste", quantity: 1, unit: "pcs", rawText: "salt to taste" },
      ],
    });
  });

  it("falls back to the legacy `ingredients` field when `recipeIngredient` is absent", () => {
    const node = { "@type": "Recipe", name: "Toast", ingredients: ["2 slices bread"] };
    expect(mapJsonLdToRecipe(node).ingredients).toEqual([{ name: "bread", quantity: 2, unit: "slices", rawText: "2 slices bread" }]);
  });

  it("handles a missing name gracefully", () => {
    const node = { "@type": "Recipe", recipeIngredient: ["1 egg"] };
    expect(mapJsonLdToRecipe(node).name).toBe("");
  });
});

