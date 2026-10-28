import { describe, expect, it } from "vitest";
import { mapJsonLdToRecipe } from "./parse-jsonld";
import { parseRecipeFromHtml } from "./parse";

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
        { name: "flour", quantity: 2, unit: "cups", rawText: "2 cups flour" },
        { name: "milk", quantity: 1, unit: "cup", rawText: "1 cup milk" },
        { name: "eggs", quantity: 2, unit: "pcs", rawText: "2 eggs" },
      ],
      source: "jsonld",
      tags: [],
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
        { name: "smör till formen", quantity: 1, unit: "pcs", rawText: "smör till formen" },
        { name: "smör", quantity: 100, unit: "g", rawText: "100 g smör" },
        { name: "ägg", quantity: 2, unit: "st", rawText: "2 st ägg" },
        { name: "strösocker", quantity: 2.5, unit: "dl", rawText: "2 1/2 dl strösocker" },
        { name: "kakao", quantity: 3, unit: "msk", rawText: "3 msk kakao" },
        { name: "vaniljsocker", quantity: 2, unit: "tsk", rawText: "2 tsk vaniljsocker" },
        { name: "vetemjöl", quantity: 1.5, unit: "dl", rawText: "1 1/2 dl vetemjöl" },
        { name: "salt", quantity: 1, unit: "krm", rawText: "1 krm salt" },
      ],
      source: "jsonld",
      tags: [],
    });
  });
});

describe("parseRecipeFromHtml ingredient notes (MATCH-4)", () => {
  // The form row has its own note field (MATCH-2), so the note is passed
  // through as is, never folded back into the name.
  it("keeps the note apart on the form row and splits salt and pepper", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Löksoppa",
      recipeIngredient: ["2-3 gula lökar, finhackade", "1,5 l buljong", "salt och peppar"],
    })}</script>`;
    expect(parseRecipeFromHtml(html)?.ingredients).toEqual([
      {
        name: "gula lökar",
        quantity: 3,
        unit: "pcs",
        note: "2–3, finhackade",
        rawText: "2-3 gula lökar, finhackade",
      },
      { name: "buljong", quantity: 1.5, unit: "l", rawText: "1,5 l buljong" },
      { name: "salt", quantity: 1, unit: "pcs", rawText: "salt och peppar" },
      { name: "peppar", quantity: 1, unit: "pcs", rawText: "salt och peppar" },
    ]);
  });

  it("rounds fractional quantities to two decimals for the form", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Pannkakor",
      recipeIngredient: ["⅓ dl olja", "1⅔ dl mjölk", "⅛ tsk salt"],
    })}</script>`;
    expect(parseRecipeFromHtml(html)?.ingredients.map((i) => i.quantity)).toEqual([0.33, 1.67, 0.13]);
  });

  it("keeps name and note apart in the tier parsers", () => {
    const node = { "@type": "Recipe", recipeIngredient: ["1 gul lök, finhackad"] };
    expect(mapJsonLdToRecipe(node).ingredients).toEqual([
      { name: "gul lök", quantity: 1, unit: "pcs", note: "finhackad", rawText: "1 gul lök, finhackad" },
    ]);
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
      ingredients: [{ name: "leek", quantity: 1, unit: "pcs", rawText: "1 leek" }],
      source: "jsonld",
      tags: [],
    });
  });

  it("falls back to Microdata before the heuristic when there's no Recipe JSON-LD", () => {
    const html = `
      <script type="application/ld+json">{"@type":"BlogPosting","headline":"Hi"}</script>
      ${microdata}
      ${heuristic}
    `;
    expect(parseRecipeFromHtml(html)).toMatchObject({ name: "Microdata Soup", source: "microdata", tags: [] });
  });

  // GAP-29: only the JSON-LD tier's own `suitableForDiet` claim becomes
  // tags — see ImportedRecipe's doc comment.
  it("maps JSON-LD suitableForDiet to recipe tags, ignoring diets with no tag", () => {
    const html = `
      <script type="application/ld+json">
        {"@type":"Recipe","name":"Lentil Soup","recipeIngredient":["1 cup lentils"],
         "suitableForDiet":["https://schema.org/VeganDiet","https://schema.org/LowFatDiet","GlutenFreeDiet"]}
      </script>
    `;
    expect(parseRecipeFromHtml(html)).toMatchObject({ source: "jsonld", tags: ["vegan", "glutenFree"] });
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
