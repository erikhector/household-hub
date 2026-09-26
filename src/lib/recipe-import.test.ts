import { describe, expect, it } from "vitest";
import {
  extractJsonLdBlocks,
  findRecipeNode,
  flattenInstructions,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  mapJsonLdToRecipe,
  parseHeuristicRecipe,
  parseIngredientString,
  parseMicrodataRecipe,
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
      source: "jsonld",
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
      source: "jsonld",
    });
  });
});

describe("parseMicrodataRecipe", () => {
  const microdataPage = `
    <html>
      <head><title>Grandma's Meatballs | Old Blog</title></head>
      <body>
        <nav><h1>Old Blog</h1></nav>
        <div itemscope itemtype="http://schema.org/Recipe">
          <h2 itemprop="name">Grandma&#8217;s Meatballs</h2>
          <div itemprop="author" itemscope itemtype="http://schema.org/Person">
            By <span itemprop="name">Grandma</span>
          </div>
          <span itemprop="recipeYield">4</span>
          <ul>
            <li itemprop="recipeIngredient">500 g ground beef</li>
            <li itemprop="recipeIngredient">1 <b>egg</b></li>
            <li itemprop="recipeIngredient">salt &amp; pepper</li>
          </ul>
          <ol>
            <li itemprop="recipeInstructions" itemscope itemtype="http://schema.org/HowToStep">
              <span itemprop="text">Mix everything.</span>
            </li>
            <li itemprop="recipeInstructions" itemscope itemtype="http://schema.org/HowToStep">
              <span itemprop="text">Roll and fry.</span>
            </li>
          </ol>
        </div>
      </body>
    </html>
  `;

  it("reads the Recipe item's own properties, ignoring nested items' `name`", () => {
    expect(parseMicrodataRecipe(microdataPage)).toEqual({
      name: "Grandma’s Meatballs",
      instructions: "Mix everything.\nRoll and fry.",
      ingredients: [
        { name: "ground beef", quantity: 500, unit: "g" },
        { name: "egg", quantity: 1, unit: "pcs" },
        { name: "salt & pepper", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("honors `content` attributes, the legacy `ingredients` prop, and https itemtypes", () => {
    const html = `
      <article itemscope itemtype="https://schema.org/Recipe">
        <meta itemprop="name" content="Toast">
        <p itemprop="ingredients">2 slices bread</p>
        <div itemprop="recipeInstructions"><p>Toast the bread.</p><p>Butter it.</p></div>
      </article>
    `;
    expect(parseMicrodataRecipe(html)).toEqual({
      name: "Toast",
      instructions: "Toast the bread.\nButter it.",
      ingredients: [{ name: "bread", quantity: 2, unit: "slices" }],
    });
  });

  it("falls back to the page's <h1> when the item has no name", () => {
    const html = `
      <h1>Plain Rice</h1>
      <div itemscope itemtype="http://schema.org/Recipe">
        <span itemprop="recipeIngredient">2 dl ris</span>
      </div>
    `;
    expect(parseMicrodataRecipe(html)?.name).toBe("Plain Rice");
  });

  it("returns null without a Recipe itemscope", () => {
    const html = `<div itemscope itemtype="http://schema.org/Person"><span itemprop="name">X</span></div>`;
    expect(parseMicrodataRecipe(html)).toBeNull();
  });
});

describe("parseHeuristicRecipe", () => {
  it("reads the title plus the lists under Ingredients/Instructions headings", () => {
    const html = `
      <html>
        <head><title>Lemon Cake - Some Blog</title></head>
        <body>
          <h1>Lemon Cake</h1>
          <p>My kids love this cake. Here are some ingredients I considered…</p>
          <ul><li>Not an ingredient, a nav link</li></ul>
          <h2>Ingredients:</h2>
          <h3>For the cake</h3>
          <ul>
            <li>2 cups flour</li>
            <li>1 cup sugar
          </ul>
          <h3>For the glaze</h3>
          <ul><li>1 lemon</li></ul>
          <h2>Instructions</h2>
          <ol><li>Bake the cake.</li><li>Glaze it.</li></ol>
          <h2>Comments</h2>
          <ul><li>Great recipe!</li></ul>
        </body>
      </html>
    `;
    expect(parseHeuristicRecipe(html)).toEqual({
      name: "Lemon Cake",
      instructions: "Bake the cake.\nGlaze it.",
      ingredients: [
        { name: "flour", quantity: 2, unit: "cups" },
        { name: "sugar", quantity: 1, unit: "cup" },
        { name: "lemon", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("handles Swedish headings, a <title>-only name, and paragraph steps", () => {
    const html = `
      <head><title>Pannkakor | Matbloggen</title></head>
      <h3>Ingredienser till 4 portioner</h3>
      <ul><li>3 dl vetemjöl</li><li>6 dl mjölk</li><li>3 st ägg</li></ul>
      <h3>Gör så här</h3>
      <p>Vispa ihop allt.</p>
      <p>Stek tunna pannkakor.
      <h3>Fler recept</h3>
      <p>Prova även våfflor!</p>
    `;
    expect(parseHeuristicRecipe(html)).toEqual({
      name: "Pannkakor",
      instructions: "Vispa ihop allt.\nStek tunna pannkakor.",
      ingredients: [
        { name: "vetemjöl", quantity: 3, unit: "dl" },
        { name: "mjölk", quantity: 6, unit: "dl" },
        { name: "ägg", quantity: 3, unit: "st" },
      ],
    });
  });

  it("returns null when there's no ingredients heading (a title alone isn't a recipe)", () => {
    const html = `<h1>Why these ingredients matter</h1><ul><li>2 cups flour</li></ul>`;
    expect(parseHeuristicRecipe(html)).toBeNull();
  });

  it("returns null when the ingredients heading has nothing under it", () => {
    expect(parseHeuristicRecipe(`<h1>Cake</h1><h2>Ingredients</h2><h2>Method</h2>`)).toBeNull();
  });
});

describe("parseRecipeFromHtml fallback order", () => {
  const microdata = `
    <div itemscope itemtype="http://schema.org/Recipe">
      <span itemprop="name">Microdata Soup</span>
      <span itemprop="recipeIngredient">1 onion</span>
    </div>
  `;
  const heuristic = `<h1>Heuristic Soup</h1><h2>Ingredients</h2><ul><li>2 carrots</li></ul>`;

  it("prefers JSON-LD over Microdata and the heuristic, unchanged", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","name":"JSON-LD Soup","recipeIngredient":["1 leek"]}
      </script>
      ${microdata}
      ${heuristic}
    `;
    expect(parseRecipeFromHtml(html)).toEqual({
      name: "JSON-LD Soup",
      instructions: "",
      ingredients: [{ name: "leek", quantity: 1, unit: "pcs" }],
      source: "jsonld",
    });
  });

  it("falls back to Microdata before the heuristic when there's no Recipe JSON-LD", () => {
    const html = `
      <script type="application/ld+json">{"@type":"BlogPosting","headline":"Hi"}</script>
      ${microdata}
      ${heuristic}
    `;
    expect(parseRecipeFromHtml(html)).toMatchObject({ name: "Microdata Soup", source: "microdata" });
  });

  it("falls back to the heuristic when there's no structured data at all", () => {
    expect(parseRecipeFromHtml(heuristic)).toMatchObject({
      name: "Heuristic Soup",
      ingredients: [{ name: "carrots", quantity: 2, unit: "pcs" }],
      source: "heuristic",
    });
  });

  it("ignores lists inside scripts and comments when guessing", () => {
    const html = `
      <h1>Ghost</h1>
      <!-- <h2>Ingredients</h2><ul><li>1 cup commented</li></ul> -->
      <script>const tpl = "<h2>Ingredients</h2><ul><li>1 cup scripted</li></ul>";</script>
    `;
    expect(parseRecipeFromHtml(html)).toBeNull();
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

// The fallback tiers run on whatever HTML an imported URL returns, so broken
// or hostile markup must not turn into seconds of server CPU. Each case
// below was quadratic before GAP-31's scans were bounded (a 400KB page of
// unclosed <h2>s took ~13s); the time limit is deliberately loose so it only
// catches a regression back to that, not a slow CI runner.
describe("parseRecipeFromHtml on pathological markup", () => {
  const MB = 1_000_000;
  const cases: Array<[string, string]> = [
    ["unclosed headings", "<h2>x"],
    ["unclosed scripts", "<script>x"],
    ["unclosed comments", "<!--x"],
    ["unclosed list items", "<ul><li>x"],
    ["nested Microdata items", '<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="name">x'],
  ];

  for (const [label, unit] of cases) {
    it(`stays fast on 1MB of ${label}`, () => {
      const html = `<html><body>${unit.repeat(Math.floor(MB / unit.length))}`;
      const started = performance.now();
      parseRecipeFromHtml(html);
      expect(performance.now() - started).toBeLessThan(5_000);
    });
  }
});
