import { describe, expect, it } from "vitest";
import type { ParsedIngredient } from "./types";
import { parseIngredientLine, parseIngredientString } from "./parse-ingredient";

describe("parseIngredientString", () => {
  // Every parsed line carries its original text (whitespace collapsed) as
  // `rawText`, so each case states only the fields that vary.
  function expectParsed(raw: string, expected: Omit<ParsedIngredient, "rawText">) {
    expect(parseIngredientString(raw)).toEqual({ ...expected, rawText: raw.trim().replace(/\s+/g, " ") });
  }

  it("splits a simple quantity + unit + name", () => {
    expectParsed("2 cups flour", { name: "flour", quantity: 2, unit: "cups" });
  });

  it("splits a decimal quantity", () => {
    expectParsed("1.5 tbsp olive oil", { name: "olive oil", quantity: 1.5, unit: "tbsp" });
  });

  it("splits a simple fraction", () => {
    expectParsed("1/2 cup sugar", { name: "sugar", quantity: 0.5, unit: "cup" });
  });

  it("splits a mixed number", () => {
    expectParsed("1 1/2 cups sugar", { name: "sugar", quantity: 1.5, unit: "cups" });
  });

  it("defaults to unit pcs when there's a leading number but no recognized unit word", () => {
    expectParsed("2 eggs", { name: "eggs", quantity: 2, unit: "pcs" });
  });

  it("falls back to the whole string with quantity 1 when there's no leading number", () => {
    expectParsed("a pinch of salt", { name: "a pinch of salt", quantity: 1, unit: "pcs" });
  });

  it("falls back to the whole string when the leading number has nothing after it", () => {
    expectParsed("2", { name: "2", quantity: 1, unit: "pcs" });
  });

  it("returns an empty row for a blank line", () => {
    expect(parseIngredientString("   ")).toEqual({ name: "", quantity: 1, unit: "pcs" });
  });

  it("trims and collapses internal whitespace", () => {
    expectParsed("  2   cups   flour  ", { name: "flour", quantity: 2, unit: "cups" });
  });

  it("handles an abbreviated unit with a trailing period", () => {
    expectParsed("3 tbsp. butter", { name: "butter", quantity: 3, unit: "tbsp" });
  });

  // Swedish (e.g. ICA recipes) — strings pulled from real ica.se Recipe JSON-LD.
  it("splits a Swedish mixed number with a dl unit", () => {
    expectParsed("2 1/2 dl strösocker", { name: "strösocker", quantity: 2.5, unit: "dl" });
  });

  it("splits a Swedish krm (kryddmått) unit", () => {
    expectParsed("1 krm salt", { name: "salt", quantity: 1, unit: "krm" });
  });

  it("splits a Swedish st (styck) unit", () => {
    expectParsed("2 st ägg", { name: "ägg", quantity: 2, unit: "st" });
  });

  it("splits Swedish msk/tsk units", () => {
    expectParsed("3 msk kakao", { name: "kakao", quantity: 3, unit: "msk" });
    expectParsed("2 tsk vaniljsocker", { name: "vaniljsocker", quantity: 2, unit: "tsk" });
  });

  it("moves a Swedish förp (förpackning) unit's trailing parenthetical to the note", () => {
    // "kokta" describes the product you buy, not a prep step, so it stays.
    expectParsed("2 förp kokta gröna linser (à 380 g)", {
      name: "kokta gröna linser",
      quantity: 2,
      unit: "förp",
      note: "à 380 g",
    });
  });

  it("falls back to the whole string for a Swedish ingredient with no unit", () => {
    expectParsed("1/2 citron", { name: "citron", quantity: 0.5, unit: "pcs" });
    expectParsed("salt", { name: "salt", quantity: 1, unit: "pcs" });
  });

  // MATCH-4: every line from the design doc's §1 table.
  describe("design-doc examples", () => {
    it("3 eggs", () => {
      expectParsed("3 eggs", { name: "eggs", quantity: 3, unit: "pcs" });
    });

    it("2 dl crème fraiche, gärna lätt", () => {
      expectParsed("2 dl crème fraiche, gärna lätt", {
        name: "crème fraiche",
        quantity: 2,
        unit: "dl",
        note: "gärna lätt",
      });
    });

    it("1 gul lök, finhackad", () => {
      expectParsed("1 gul lök, finhackad", { name: "gul lök", quantity: 1, unit: "pcs", note: "finhackad" });
    });

    it("½ tsk salt", () => {
      expectParsed("½ tsk salt", { name: "salt", quantity: 0.5, unit: "tsk" });
    });

    it("1,5 dl mjölk", () => {
      expectParsed("1,5 dl mjölk", { name: "mjölk", quantity: 1.5, unit: "dl" });
    });

    it("2-3 vitlöksklyftor", () => {
      expectParsed("2-3 vitlöksklyftor", { name: "vitlöksklyftor", quantity: 3, unit: "pcs", note: "2–3" });
    });

    it("300 g vetemjöl", () => {
      expectParsed("300 g vetemjöl", { name: "vetemjöl", quantity: 300, unit: "g" });
    });

    it("vatten", () => {
      expectParsed("vatten", { name: "vatten", quantity: 1, unit: "pcs" });
    });
  });

  describe("unicode fractions", () => {
    it.each([
      ["¼ tsk kanel", 0.25, "tsk", "kanel"],
      ["¾ cup milk", 0.75, "cup", "milk"],
      ["⅓ cup honey", 1 / 3, "cup", "honey"],
      ["⅔ dl grädde", 2 / 3, "dl", "grädde"],
      ["1½ dl mjölk", 1.5, "dl", "mjölk"],
      ["1 ½ cups flour", 1.5, "cups", "flour"],
      ["2¼ kg potatis", 2.25, "kg", "potatis"],
    ])("%s", (raw, quantity, unit, name) => {
      expectParsed(raw, { name, quantity, unit });
    });

    it("reads a fraction slash as a plain slash", () => {
      expectParsed("1⁄2 cup sugar", { name: "sugar", quantity: 0.5, unit: "cup" });
    });
  });

  it("reads comma decimals in English lines too", () => {
    expectParsed("0,5 l cream", { name: "cream", quantity: 0.5, unit: "l" });
  });

  it("reads English thousands separators as thousands, not decimals", () => {
    expectParsed("1,000 g flour", { name: "flour", quantity: 1000, unit: "g" });
    expectParsed("12,500 ml water", { name: "water", quantity: 12500, unit: "ml" });
    expectParsed("1,000,000 grains rice", { name: "grains rice", quantity: 1000000, unit: "pcs" });
    // A leading zero or a non-three-digit tail is still a decimal.
    expectParsed("0,125 l grädde", { name: "grädde", quantity: 0.125, unit: "l" });
    expectParsed("1,25 kg potatis", { name: "potatis", quantity: 1.25, unit: "kg" });
    expectParsed("1,0000 kg x", { name: "x", quantity: 1, unit: "kg" });
  });

  it("finds the unit behind a parenthesized pack size", () => {
    expectParsed("1 (400 g) burk tomater", { name: "tomater", quantity: 1, unit: "burk", note: "400 g" });
    expectParsed("2 (14.5 oz) cans diced tomatoes", {
      name: "diced tomatoes",
      quantity: 2,
      unit: "cans",
      note: "14.5 oz",
    });
  });

  describe("ranges", () => {
    it("takes the upper bound across hyphen, en dash, em dash and spaces", () => {
      expectParsed("2–3 msk olja", { name: "olja", quantity: 3, unit: "msk", note: "2–3" });
      expectParsed("1 - 2 cups stock", { name: "stock", quantity: 2, unit: "cups", note: "1–2" });
      expectParsed("4—6 potatoes", { name: "potatoes", quantity: 6, unit: "pcs", note: "4–6" });
    });

    it("handles fractional and decimal bounds", () => {
      expectParsed("½-1 tsk chili", { name: "chili", quantity: 1, unit: "tsk", note: "½–1" });
      expectParsed("1,5-2 dl vatten", { name: "vatten", quantity: 2, unit: "dl", note: "1,5–2" });
    });

    it("puts the range before other notes", () => {
      expectParsed("2-3 gula lökar, hackade", {
        name: "gula lökar",
        quantity: 3,
        unit: "pcs",
        note: "2–3, hackade",
      });
    });
  });

  describe("approximation words", () => {
    it.each([
      ["ca 500 g potatis", "potatis", 500, "g"],
      ["ca. 2 dl vatten", "vatten", 2, "dl"],
      ["cirka 1 kg köttfärs", "köttfärs", 1, "kg"],
      ["ungefär 3 msk olja", "olja", 3, "msk"],
      ["about 2 cups rice", "rice", 2, "cups"],
      ["About 1 lb chicken", "chicken", 1, "lb"],
    ])("%s", (raw, name, quantity, unit) => {
      expectParsed(raw, { name, quantity, unit });
    });

    it("keeps the whole line when no number follows", () => {
      expectParsed("about a handful basil", { name: "about a handful basil", quantity: 1, unit: "pcs" });
    });
  });

  describe("units attached to the number", () => {
    it.each([
      ["500g smör", "smör", 500, "g"],
      ["2dl grädde", "grädde", 2, "dl"],
      ["1,5dl mjölk", "mjölk", 1.5, "dl"],
      ["250ml milk", "milk", 250, "ml"],
      ["1½dl socker", "socker", 1.5, "dl"],
    ])("%s", (raw, name, quantity, unit) => {
      expectParsed(raw, { name, quantity, unit });
    });
  });

  describe("prep notes", () => {
    it("moves text after the first comma to the note", () => {
      expectParsed("2 onions, peeled, chopped", {
        name: "onions",
        quantity: 2,
        unit: "pcs",
        note: "peeled, chopped",
      });
    });

    it("moves parenthesized text to the note", () => {
      expectParsed("200 g fetaost (gärna ekologisk)", {
        name: "fetaost",
        quantity: 200,
        unit: "g",
        note: "gärna ekologisk",
      });
      expectParsed("1 can (400 g) chopped tomatoes", {
        name: "chopped tomatoes",
        quantity: 1,
        unit: "can",
        note: "400 g",
      });
    });

    it("splits notes from lines without a quantity", () => {
      expectParsed("salt, efter smak", { name: "salt", quantity: 1, unit: "pcs", note: "efter smak" });
      expectParsed("olive oil (for frying)", { name: "olive oil", quantity: 1, unit: "pcs", note: "for frying" });
    });

    it("moves leading prep adjectives to the note", () => {
      expectParsed("1 finhackad gul lök", { name: "gul lök", quantity: 1, unit: "pcs", note: "finhackad" });
      expectParsed("2 grovhackade valnötter", {
        name: "valnötter",
        quantity: 2,
        unit: "pcs",
        note: "grovhackade",
      });
      expectParsed("1 fint hackad schalottenlök", {
        name: "schalottenlök",
        quantity: 1,
        unit: "pcs",
        note: "fint hackad",
      });
      expectParsed("2 finely chopped shallots", {
        name: "shallots",
        quantity: 2,
        unit: "pcs",
        note: "finely chopped",
      });
      expectParsed("3 pressade vitlöksklyftor, gärna mer", {
        name: "vitlöksklyftor",
        quantity: 3,
        unit: "pcs",
        note: "pressade, gärna mer",
      });
    });

    it("keeps product-describing adjectives in the name", () => {
      expectParsed("500 g ground beef", { name: "ground beef", quantity: 500, unit: "g" });
      expectParsed("200 g rökt lax", { name: "rökt lax", quantity: 200, unit: "g" });
    });

    // Prep participles that are also packaged goods stay whole, so they
    // link to e.g. "Krossade tomater" rather than fresh tomatoes.
    it.each([
      ["400 g krossade tomater", "krossade tomater", 400, "g"],
      ["400 g hackade tomater", "hackade tomater", 400, "g"],
      ["400 g skalade tomater", "skalade tomater", 400, "g"],
      ["200 g riven ost", "riven ost", 200, "g"],
      ["100 g skivad mandel", "skivad mandel", 100, "g"],
      ["1 tsk crushed red pepper", "crushed red pepper", 1, "tsk"],
      ["1 cup shredded cheese", "shredded cheese", 1, "cup"],
      ["2 tbsp minced garlic", "minced garlic", 2, "tbsp"],
      ["1 cup grated parmesan", "grated parmesan", 1, "cup"],
      ["2 cups sliced mushrooms", "sliced mushrooms", 2, "cups"],
      ["1 cup diced tomatoes", "diced tomatoes", 1, "cup"],
      ["1 can chopped tomatoes", "chopped tomatoes", 1, "can"],
    ])("keeps %s whole", (raw, name, quantity, unit) => {
      expectParsed(raw, { name, quantity, unit });
    });

    it("still splits those words off after a comma", () => {
      expectParsed("2 msk parmesan, riven", { name: "parmesan", quantity: 2, unit: "msk", note: "riven" });
    });

    it("never empties the name", () => {
      expectParsed("1 finhackad", { name: "finhackad", quantity: 1, unit: "pcs" });
      expectParsed("(valfritt)", { name: "(valfritt)", quantity: 1, unit: "pcs" });
    });

    it("treats an adverb alone as part of the name", () => {
      expectParsed("1 dl finely milled flour", { name: "finely milled flour", quantity: 1, unit: "dl" });
    });
  });
});

describe("parseIngredientLine", () => {
  it("returns a single row for an ordinary line", () => {
    expect(parseIngredientLine("1 gul lök, finhackad")).toEqual([
      { name: "gul lök", quantity: 1, unit: "pcs", note: "finhackad", rawText: "1 gul lök, finhackad" },
    ]);
  });

  it.each([
    ["salt och peppar", "salt", "peppar"],
    ["Salt och svartpeppar", "Salt", "svartpeppar"],
    ["salt and pepper", "salt", "pepper"],
    ["salt & black pepper", "salt", "black pepper"],
  ])("splits %s into two rows", (raw, first, second) => {
    expect(parseIngredientLine(raw)).toEqual([
      { name: first, quantity: 1, unit: "pcs", rawText: raw },
      { name: second, quantity: 1, unit: "pcs", rawText: raw },
    ]);
  });

  it("keeps the note on both halves", () => {
    expect(parseIngredientLine("salt och peppar, efter smak")).toEqual([
      { name: "salt", quantity: 1, unit: "pcs", note: "efter smak", rawText: "salt och peppar, efter smak" },
      { name: "peppar", quantity: 1, unit: "pcs", note: "efter smak", rawText: "salt och peppar, efter smak" },
    ]);
  });

  it("splits a comma-separated salt, peppar and keeps the rest of the note", () => {
    expect(parseIngredientLine("Salt, peppar")).toEqual([
      { name: "Salt", quantity: 1, unit: "pcs", rawText: "Salt, peppar" },
      { name: "peppar", quantity: 1, unit: "pcs", rawText: "Salt, peppar" },
    ]);
    expect(parseIngredientLine("salt, svartpeppar, efter smak")).toEqual([
      { name: "salt", quantity: 1, unit: "pcs", note: "efter smak", rawText: "salt, svartpeppar, efter smak" },
      { name: "svartpeppar", quantity: 1, unit: "pcs", note: "efter smak", rawText: "salt, svartpeppar, efter smak" },
    ]);
  });

  it("leaves salt with another note alone", () => {
    expect(parseIngredientLine("salt, efter smak")).toEqual([
      { name: "salt", quantity: 1, unit: "pcs", note: "efter smak", rawText: "salt, efter smak" },
    ]);
  });

  it("doesn't split other 'and' names", () => {
    expect(parseIngredientLine("1 dl sweet and sour sauce")).toHaveLength(1);
    expect(parseIngredientLine("salt och pepparmix")).toHaveLength(1);
  });
});

