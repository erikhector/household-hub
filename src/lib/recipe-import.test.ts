import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchRecipeHtml (SEC-2) is the one part of this module that touches the
// network: it resolves DNS via node:dns and connects via node:http/https, so
// exercising its SSRF/DNS-rebinding guard and its abort-timer behavior means
// faking those three built-ins rather than hitting anything real. The fake
// http(s) client below replicates just enough of Node's own contract to be
// faithful to what we're testing: `http(s).request(url, options, callback)`
// calls `options.lookup(hostname, opts, cb)` itself before "connecting" (real
// Node does exactly this inside net.connect), so routing the plumbing through
// the same `lookup` recipe-import.ts passes in is what proves a private
// resolution never reaches a connection — not just that the lookup function
// returns the right thing in isolation.
type FakeResponsePlan = {
  statusCode: number;
  headers?: Record<string, string>;
  bodyChunks?: string[];
  onEnd?: () => void;
};

function createFakeEmitter() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners[event] ?? []) fn(...args);
    },
  };
}

const { lookupMock, connectSpy, responsePlans, requestMock } = vi.hoisted(() => {
  const responsePlans: FakeResponsePlan[] = [];
  const connectSpy = vi.fn();
  const lookupMock = vi.fn();
  const requestMock = vi.fn(
    (
      url: URL,
      options: { lookup: (hostname: string, opts: unknown, cb: (...args: unknown[]) => void) => void },
      callback: (res: unknown) => void,
    ) => {
      const req = createFakeEmitter() as ReturnType<typeof createFakeEmitter> & {
        end: () => void;
        destroy: () => void;
      };
      req.end = () => {
        // Real Node calls `lookup` with `{ all: true, ... }` here — net's
        // `autoSelectFamily` (on by default since Node 20) means
        // http(s).request always wants every resolved address up front, to
        // attempt them in turn (Happy Eyeballs), never the single
        // `(address, family)` shape. Faking that any other way is exactly
        // how the earlier version of this fix passed tests while still
        // breaking every real request (ERR_INVALID_IP_ADDRESS) — see
        // fetchRecipeHtml's real-http.createServer tests further down for
        // the version of this contract that isn't faked at all.
        const onLookup = (err: NodeJS.ErrnoException | null, records: Array<{ address: string; family: number }>) => {
          if (err) {
            queueMicrotask(() => req.emit("error", err));
            return;
          }
          const [{ address, family }] = records;
          connectSpy(url.hostname, address, family);
          const plan = responsePlans.shift();
          if (!plan) {
            queueMicrotask(() => req.emit("error", new Error(`no response plan queued for ${url.href}`)));
            return;
          }
          const res = createFakeEmitter() as ReturnType<typeof createFakeEmitter> & {
            statusCode: number;
            headers: Record<string, string>;
            resume: () => void;
            destroy: () => void;
          };
          res.statusCode = plan.statusCode;
          res.headers = plan.headers ?? {};
          res.resume = () => {};
          res.destroy = () => {};
          callback(res);
          queueMicrotask(() => {
            for (const chunk of plan.bodyChunks ?? []) res.emit("data", Buffer.from(chunk));
            plan.onEnd?.();
            res.emit("end");
          });
        };
        options.lookup(url.hostname, { all: true }, onLookup as (...args: unknown[]) => void);
      };
      req.destroy = () => {};
      return req;
    },
  );
  return { lookupMock, connectSpy, responsePlans, requestMock };
});

vi.mock("node:dns", () => ({ promises: { lookup: lookupMock } }));
vi.mock("node:http", () => ({ default: { request: requestMock } }));
vi.mock("node:https", () => ({ default: { request: requestMock } }));

import {
  extractJsonLdBlocks,
  fetchRecipeHtml,
  findRecipeNode,
  flattenInstructions,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  mapJsonLdToRecipe,
  parseHeuristicRecipe,
  parseIngredientLine,
  parseIngredientString,
  parseMicrodataRecipe,
  type ParsedIngredient,
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
  // Until RecipeIngredient has a note column (MATCH-2) the form only has a
  // name, so the note rides along in parentheses there.
  it("appends the note to the form row's name and splits salt and pepper", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Löksoppa",
      recipeIngredient: ["2-3 gula lökar, finhackade", "1,5 l buljong", "salt och peppar"],
    })}</script>`;
    expect(parseRecipeFromHtml(html)?.ingredients).toEqual([
      { name: "gula lökar (2–3, finhackade)", quantity: 3, unit: "pcs", rawText: "2-3 gula lökar, finhackade" },
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
        { name: "ground beef", quantity: 500, unit: "g", rawText: "500 g ground beef" },
        { name: "egg", quantity: 1, unit: "pcs", rawText: "1 egg" },
        { name: "salt", quantity: 1, unit: "pcs", rawText: "salt & pepper" },
        { name: "pepper", quantity: 1, unit: "pcs", rawText: "salt & pepper" },
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
      ingredients: [{ name: "bread", quantity: 2, unit: "slices", rawText: "2 slices bread" }],
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
        { name: "flour", quantity: 2, unit: "cups", rawText: "2 cups flour" },
        { name: "sugar", quantity: 1, unit: "cup", rawText: "1 cup sugar" },
        { name: "lemon", quantity: 1, unit: "pcs", rawText: "1 lemon" },
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
        { name: "vetemjöl", quantity: 3, unit: "dl", rawText: "3 dl vetemjöl" },
        { name: "mjölk", quantity: 6, unit: "dl", rawText: "6 dl mjölk" },
        { name: "ägg", quantity: 3, unit: "st", rawText: "3 st ägg" },
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

beforeEach(() => {
  lookupMock.mockReset();
  requestMock.mockClear();
  connectSpy.mockClear();
  responsePlans.length = 0;
});

// SEC-2: assertResolvesToPublicAddress used to check the hostname once, then
// let `fetch` resolve it again to actually connect — two independent DNS
// queries a rebinding server could answer differently. fetchRecipeHtml now
// pins DNS resolution to the exact lookup that connects (createPinnedPublicLookup,
// passed straight to http(s).request), so there's only ever one query per
// connection attempt and it's the one that's validated.
describe("fetchRecipeHtml — DNS-rebinding guard (SEC-2)", () => {
  it("blocks a hostname whose only DNS answer is private, and never connects", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    const result = await fetchRecipeHtml("http://attacker.example/recipe");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks a multi-answer response with a private record even when a public one is also listed", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 }, // cloud metadata address
    ]);

    const result = await fetchRecipeHtml("http://attacker.example/recipe");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks a redirect hop that rebinds to a private address after the first hop resolved publicly, and never connects to it", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // hop 0: public
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]); // hop 1's redirect target: rebinds to loopback
    responsePlans.push({ statusCode: 302, headers: { location: "http://internal.example/secret" } });

    const result = await fetchRecipeHtml("http://recipe-site.example/page");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    // Exactly one connection — hop 0. Hop 1's private resolution must never
    // reach a connection at all, not merely fail after connecting.
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});

// SEC-2: the abort timer used to be cleared right after the initial fetch()
// call returned (i.e. once headers arrived), leaving the body read that
// followed with nothing to cut it off — a slow-drip response could stall
// well past FETCH_TIMEOUT_MS. It must stay armed until the body is fully
// read.
describe("fetchRecipeHtml — abort timer covers the body read (SEC-2)", () => {
  it("only clears the per-hop timeout after the body has fully been read", async () => {
    const timeline: string[] = [];
    const realClearTimeout = globalThis.clearTimeout;
    const clearTimeoutSpy = vi
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation((id: Parameters<typeof clearTimeout>[0]) => {
        timeline.push("clearTimeout");
        return realClearTimeout(id);
      });

    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    responsePlans.push({
      statusCode: 200,
      bodyChunks: ["<html></html>"],
      onEnd: () => timeline.push("body-end"),
    });

    const result = await fetchRecipeHtml("http://recipe-site.example/page");

    expect(result).toEqual({ ok: true, html: "<html></html>" });
    // clearTimeout must come strictly after the body finished — if it were
    // cleared as soon as headers arrived (the SEC-2 bug), "clearTimeout"
    // would appear before "body-end" here instead.
    expect(timeline).toEqual(["body-end", "clearTimeout"]);

    clearTimeoutSpy.mockRestore();
  });
});
