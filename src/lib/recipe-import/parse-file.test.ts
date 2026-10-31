import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { parseRecipeFile, RECIPE_FILE_MAX_BYTES, RECIPE_FILE_MAX_RECIPES } from "./parse-file";
import { buildPaprikaArchive, buildZip } from "./zip-fixture";

const pancakes = {
  name: "Pancakes",
  ingredients: "2 dl flour\n1 tbsp sugar\n\n3 eggs, beaten",
  directions: "Whisk.\nFry.",
  notes: "Serve warm.",
  servings: "Serves 6-8",
  categories: ["Breakfast"],
};

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe("parseRecipeFile: .paprikarecipes", () => {
  it("reads a gzipped entry: ingredient lines, steps, notes and servings", () => {
    const result = parseRecipeFile(buildPaprikaArchive([pancakes]));
    expect(result).toMatchObject({ ok: true, skipped: 0 });
    if (!result.ok) return;
    const [recipe] = result.recipes;
    expect(recipe.name).toBe("Pancakes");
    expect(recipe.servings).toBe(6);
    expect(recipe.instructions).toBe("Whisk.\nFry.\n\nServe warm.");
    expect(recipe.ingredients).toHaveLength(3);
    expect(recipe.ingredients[0]).toMatchObject({ name: "flour", quantity: 2 });
    expect(recipe.ingredients[1]).toMatchObject({ name: "sugar", quantity: 1, unit: "tbsp" });
    expect(recipe.ingredients[2]).toMatchObject({ name: "eggs", quantity: 3, note: "beaten" });
  });

  it("also reads deflated entries and a plain (ungzipped) JSON entry", () => {
    const zip = buildZip([
      { name: "a.paprikarecipe", data: gzipSync(json(pancakes)), method: 8 },
      { name: "b.json", data: json({ name: "Soup", ingredients: "1 onion" }), method: 8 },
    ]);
    const result = parseRecipeFile(zip);
    expect(result.ok && result.recipes.map((r) => r.name)).toEqual(["Pancakes", "Soup"]);
  });

  it("skips corrupt entries and counts them", () => {
    const zip = buildZip([
      { name: "good.paprikarecipe", data: gzipSync(json(pancakes)), method: 0 },
      // Starts like gzip, isn't.
      { name: "bad.paprikarecipe", data: Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]), method: 0 },
      { name: "noname.paprikarecipe", data: gzipSync(json({ ingredients: "1 egg" })), method: 0 },
      { name: "text.paprikarecipe", data: Buffer.from("not json"), method: 0 },
    ]);
    const result = parseRecipeFile(zip);
    expect(result).toMatchObject({ ok: true, skipped: 3 });
    expect(result.ok && result.recipes).toHaveLength(1);
  });

  it("ignores directory and macOS resource entries", () => {
    const zip = buildZip([
      { name: "__MACOSX/._a", data: Buffer.from("x"), method: 0 },
      { name: "dir/", data: Buffer.alloc(0), method: 0 },
      { name: "a.paprikarecipe", data: gzipSync(json(pancakes)), method: 0 },
    ]);
    expect(parseRecipeFile(zip)).toMatchObject({ ok: true, skipped: 0 });
  });

  it("reports noRecipes when every entry is unusable", () => {
    const zip = buildZip([{ name: "bad", data: Buffer.from("nope"), method: 0 }]);
    expect(parseRecipeFile(zip)).toEqual({ ok: false, error: "noRecipes" });
  });

  it("stops an entry that inflates past the ceiling instead of reading it", () => {
    const bomb = gzipSync(Buffer.alloc(9 * 1024 * 1024, "a"));
    const zip = buildZip([{ name: "bomb", data: bomb, method: 0 }]);
    expect(parseRecipeFile(zip)).toEqual({ ok: false, error: "noRecipes" });
  });

  it("clamps oversized fields to what a saved recipe allows", () => {
    const result = parseRecipeFile(
      buildPaprikaArchive([
        {
          name: "N".repeat(300),
          directions: "d".repeat(9000),
          servings: "99999",
          ingredients: Array.from({ length: 150 }, (_, i) => `${i + 1} g thing${i}`).join("\n"),
        },
      ]),
    );
    if (!result.ok) throw new Error("expected ok");
    const [recipe] = result.recipes;
    expect(recipe.name).toHaveLength(120);
    expect(recipe.instructions).toHaveLength(4000);
    expect(recipe.servings).toBe(1000);
    expect(recipe.ingredients).toHaveLength(100);
  });
});

describe("parseRecipeFile: JSON", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Tomato soup",
    recipeIngredient: ["400 g tomatoes", "1 onion"],
    recipeInstructions: [{ "@type": "HowToStep", text: "Simmer." }],
    recipeYield: "4 servings",
    suitableForDiet: "https://schema.org/VeganDiet",
  };

  it("reads one Recipe JSON-LD object", () => {
    const result = parseRecipeFile(json(ld));
    if (!result.ok) throw new Error("expected ok");
    expect(result.recipes[0]).toMatchObject({ name: "Tomato soup", instructions: "Simmer.", servings: 4 });
    expect(result.recipes[0].ingredients).toHaveLength(2);
    expect(result.recipes[0].tags).toContain("vegan");
  });

  it("reads an array and a @graph, skipping unusable recipes", () => {
    expect(parseRecipeFile(json([ld, { ...ld, name: "Two" }]))).toMatchObject({ ok: true });
    const graph = parseRecipeFile(json({ "@graph": [{ "@type": "WebPage" }, ld] }));
    expect(graph.ok && graph.recipes).toHaveLength(1);
    expect(parseRecipeFile(json([ld, { "@type": "Recipe" }]))).toMatchObject({ ok: true, skipped: 1 });
  });

  it("tolerates a byte-order mark", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json(ld)]);
    expect(parseRecipeFile(withBom)).toMatchObject({ ok: true });
  });

  it("rejects text that is neither a zip nor JSON, and empty files", () => {
    expect(parseRecipeFile(Buffer.from("hello"))).toEqual({ ok: false, error: "unsupported" });
    expect(parseRecipeFile(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    expect(parseRecipeFile(json({ foo: 1 }))).toEqual({ ok: false, error: "noRecipes" });
  });
});

describe("parseRecipeFile: caps", () => {
  it("rejects a file over the size cap before reading it", () => {
    expect(parseRecipeFile(new Uint8Array(RECIPE_FILE_MAX_BYTES + 1))).toEqual({ ok: false, error: "tooLarge" });
  });

  it("accepts exactly the recipe cap and rejects one more, in a zip and in JSON", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `R${i}`, ingredients: "1 egg" }));
    const atCap = parseRecipeFile(buildPaprikaArchive(make(RECIPE_FILE_MAX_RECIPES)));
    expect(atCap.ok && atCap.recipes).toHaveLength(RECIPE_FILE_MAX_RECIPES);
    expect(parseRecipeFile(buildPaprikaArchive(make(RECIPE_FILE_MAX_RECIPES + 1)))).toEqual({
      ok: false,
      error: "tooMany",
    });
    expect(parseRecipeFile(json(make(RECIPE_FILE_MAX_RECIPES + 1)))).toEqual({ ok: false, error: "tooMany" });
  });
});
