import { describe, expect, it } from "vitest";
import {
  extractJsonLdBlocks,
  findRecipeNode,
  flattenInstructions,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  mapJsonLdToRecipe,
  parseIngredientString,
  parseRecipeFromHtml,
  validateRecipeUrl,
} from "@/lib/recipe-import";

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

describe("parseIngredientString", () => {
  it("splits a simple quantity + unit + name", () => {
    expect(parseIngredientString("2 cups flour")).toEqual({ name: "flour", quantity: 2, unit: "cups" });
  });

  it("splits a decimal quantity", () => {
    expect(parseIngredientString("1.5 tbsp olive oil")).toEqual({
      name: "olive oil",
      quantity: 1.5,
      unit: "tbsp",
    });
  });

  it("splits a simple fraction", () => {
    expect(parseIngredientString("1/2 cup sugar")).toEqual({ name: "sugar", quantity: 0.5, unit: "cup" });
  });

  it("splits a mixed number", () => {
    expect(parseIngredientString("1 1/2 cups sugar")).toEqual({ name: "sugar", quantity: 1.5, unit: "cups" });
  });

  it("defaults to unit pcs when there's a leading number but no recognized unit word", () => {
    expect(parseIngredientString("2 eggs")).toEqual({ name: "eggs", quantity: 2, unit: "pcs" });
  });

  it("falls back to the whole string with quantity 1 when there's no leading number", () => {
    expect(parseIngredientString("a pinch of salt")).toEqual({
      name: "a pinch of salt",
      quantity: 1,
      unit: "pcs",
    });
  });

  it("falls back to the whole string when the leading number has nothing after it", () => {
    expect(parseIngredientString("2")).toEqual({ name: "2", quantity: 1, unit: "pcs" });
  });

  it("trims and collapses internal whitespace", () => {
    expect(parseIngredientString("  2   cups   flour  ")).toEqual({
      name: "flour",
      quantity: 2,
      unit: "cups",
    });
  });

  it("handles an abbreviated unit with a trailing period", () => {
    expect(parseIngredientString("3 tbsp. butter")).toEqual({ name: "butter", quantity: 3, unit: "tbsp" });
  });

  // Swedish (e.g. ICA recipes) — strings pulled from real ica.se Recipe JSON-LD.
  it("splits a Swedish mixed number with a dl unit", () => {
    expect(parseIngredientString("2 1/2 dl strösocker")).toEqual({
      name: "strösocker",
      quantity: 2.5,
      unit: "dl",
    });
  });

  it("splits a Swedish krm (kryddmått) unit", () => {
    expect(parseIngredientString("1 krm salt")).toEqual({ name: "salt", quantity: 1, unit: "krm" });
  });

  it("splits a Swedish st (styck) unit", () => {
    expect(parseIngredientString("2 st ägg")).toEqual({ name: "ägg", quantity: 2, unit: "st" });
  });

  it("splits Swedish msk/tsk units", () => {
    expect(parseIngredientString("3 msk kakao")).toEqual({ name: "kakao", quantity: 3, unit: "msk" });
    expect(parseIngredientString("2 tsk vaniljsocker")).toEqual({
      name: "vaniljsocker",
      quantity: 2,
      unit: "tsk",
    });
  });

  it("splits a Swedish förp (förpackning) unit with a trailing parenthetical", () => {
    expect(parseIngredientString("2 förp kokta gröna linser (à 380 g)")).toEqual({
      name: "kokta gröna linser (à 380 g)",
      quantity: 2,
      unit: "förp",
    });
  });

  it("falls back to the whole string for a Swedish ingredient with no unit", () => {
    expect(parseIngredientString("1/2 citron")).toEqual({ name: "citron", quantity: 0.5, unit: "pcs" });
    expect(parseIngredientString("salt")).toEqual({ name: "salt", quantity: 1, unit: "pcs" });
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
        { name: "tomatoes", quantity: 2, unit: "cups" },
        { name: "olive oil", quantity: 1, unit: "tbsp" },
        { name: "salt to taste", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("falls back to the legacy `ingredients` field when `recipeIngredient` is absent", () => {
    const node = { "@type": "Recipe", name: "Toast", ingredients: ["2 slices bread"] };
    expect(mapJsonLdToRecipe(node).ingredients).toEqual([{ name: "bread", quantity: 2, unit: "slices" }]);
  });

  it("handles a missing name gracefully", () => {
    const node = { "@type": "Recipe", recipeIngredient: ["1 egg"] };
    expect(mapJsonLdToRecipe(node).name).toBe("");
  });
});

describe("parseRecipeFromHtml", () => {
  it("parses a realistic recipe page end to end", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Pancakes",
              "recipeIngredient": ["2 cups flour", "1 cup milk", "2 eggs"],
              "recipeInstructions": "Mix and cook on a griddle."
            }
          </script>
        </head>
        <body><h1>Pancakes</h1></body>
      </html>
    `;
    expect(parseRecipeFromHtml(html)).toEqual({
      name: "Pancakes",
      instructions: "Mix and cook on a griddle.",
      ingredients: [
        { name: "flour", quantity: 2, unit: "cups" },
        { name: "milk", quantity: 1, unit: "cup" },
        { name: "eggs", quantity: 2, unit: "pcs" },
      ],
    });
  });

  it("returns null when the page has no JSON-LD at all", () => {
    expect(parseRecipeFromHtml("<html><body>Just a blog post.</body></html>")).toBeNull();
  });

  it("returns null when JSON-LD is present but isn't a Recipe", () => {
    const html = `<script type="application/ld+json">{"@type":"BlogPosting","headline":"Hi"}</script>`;
    expect(parseRecipeFromHtml(html)).toBeNull();
  });

  it("returns null when the Recipe node has no usable fields", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe"}</script>`;
    expect(parseRecipeFromHtml(html)).toBeNull();
  });

  it("parses a real ICA (Swedish) recipe end to end", () => {
    // Trimmed to the fields we map, from a live ica.se/recept/ Recipe JSON-LD block.
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Recipe",
              "name": "Kladdig kladdkaka",
              "recipeIngredient": [
                "smör till formen",
                "100 g smör",
                "2 st ägg",
                "2 1/2 dl strösocker",
                "3 msk kakao",
                "2 tsk vaniljsocker",
                "1 1/2 dl vetemjöl",
                "1 krm salt"
              ],
              "recipeInstructions": [
                { "@type": "HowToStep", "text": "Sätt ugnen på 200°C, under- och övervärme." },
                { "@type": "HowToStep", "text": "Vispa ihop ägg och socker." }
              ]
            }
          </script>
        </head>
        <body><h1>Kladdig kladdkaka</h1></body>
      </html>
    `;
    expect(parseRecipeFromHtml(html)).toEqual({
      name: "Kladdig kladdkaka",
      instructions: "Sätt ugnen på 200°C, under- och övervärme.\nVispa ihop ägg och socker.",
      ingredients: [
        { name: "smör till formen", quantity: 1, unit: "pcs" },
        { name: "smör", quantity: 100, unit: "g" },
        { name: "ägg", quantity: 2, unit: "st" },
        { name: "strösocker", quantity: 2.5, unit: "dl" },
        { name: "kakao", quantity: 3, unit: "msk" },
        { name: "vaniljsocker", quantity: 2, unit: "tsk" },
        { name: "vetemjöl", quantity: 1.5, unit: "dl" },
        { name: "salt", quantity: 1, unit: "krm" },
      ],
    });
  });
});

describe("validateRecipeUrl", () => {
  it("accepts a plain https URL", () => {
    const result = validateRecipeUrl("https://example.com/recipe");
    expect(result.ok).toBe(true);
  });

  it("accepts a plain http URL", () => {
    const result = validateRecipeUrl("http://example.com/recipe");
    expect(result.ok).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(validateRecipeUrl("ftp://example.com/recipe")).toEqual({
      ok: false,
      error: "invalidUrl",
    });
    expect(validateRecipeUrl("file:///etc/passwd")).toEqual({ ok: false, error: "invalidUrl" });
  });

  it("rejects a malformed URL", () => {
    expect(validateRecipeUrl("not a url")).toEqual({ ok: false, error: "invalidUrl" });
  });

  it("rejects localhost", () => {
    expect(validateRecipeUrl("http://localhost/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://foo.localhost/recipe")).toEqual({
      ok: false,
      error: "blockedHost",
    });
  });

  it("rejects a loopback IPv4 literal", () => {
    expect(validateRecipeUrl("http://127.0.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("rejects a private IPv4 literal", () => {
    expect(validateRecipeUrl("http://192.168.1.5/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://10.0.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://172.16.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("rejects a link-local IPv4 literal", () => {
    expect(validateRecipeUrl("http://169.254.169.254/latest/meta-data")).toEqual({
      ok: false,
      error: "blockedHost",
    });
  });

  it("rejects an IPv6 loopback literal", () => {
    expect(validateRecipeUrl("http://[::1]/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("accepts a public IPv4 literal", () => {
    expect(validateRecipeUrl("http://93.184.216.34/recipe").ok).toBe(true);
  });
});

describe("isPrivateOrReservedIPv4", () => {
  it("flags well-known private ranges", () => {
    expect(isPrivateOrReservedIPv4("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIPv4("192.168.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedIPv4("169.254.1.1")).toBe(true);
  });

  it("does not flag a public address", () => {
    expect(isPrivateOrReservedIPv4("8.8.8.8")).toBe(false);
  });
});

describe("isPrivateOrReservedIPv6", () => {
  it("flags loopback and link-local/unique-local ranges", () => {
    expect(isPrivateOrReservedIPv6("::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fd00::1")).toBe(true);
  });

  it("flags an IPv4-mapped private address", () => {
    expect(isPrivateOrReservedIPv6("::ffff:127.0.0.1")).toBe(true);
  });

  it("does not flag a public IPv6 address", () => {
    expect(isPrivateOrReservedIPv6("2606:4700:4700::1111")).toBe(false);
  });
});
