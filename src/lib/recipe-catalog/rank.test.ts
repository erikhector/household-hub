import { describe, expect, it } from "vitest";
import { rankCatalogRecipes, ingredientHaves, normalizeForSearch, type PantryEntry, type RankOptions } from "./rank";
import { FEATURED_COUNT, type CatalogRecipe } from "./types";

// A tiny inline catalog, not RECIPE_CATALOG: the ranking rules are what's
// under test, and a hand-built fixture lets each case name exactly the
// recipes it cares about without breaking whenever the real data changes.
function recipe(
  id: string,
  en: string,
  sv: string,
  ingredients: Array<[string, string]>,
  tags: CatalogRecipe["tags"] = [],
): CatalogRecipe {
  return {
    id,
    name: { en, sv },
    servings: 4,
    ingredients: ingredients.map(([enName, svName]) => ({
      name: { en: enName, sv: svName },
      quantity: 1,
      unit: "pcs",
    })),
    instructions: { en: "Cook.", sv: "Laga." },
    tags,
  };
}

const MEATBALLS = recipe(
  "meatballs",
  "Meatballs",
  "Köttbullar",
  [
    ["minced meat", "köttfärs"],
    ["milk", "mjölk"],
    ["onion", "lök"],
  ],
);
const SALMON = recipe(
  "salmon",
  "Salmon with potatoes",
  "Lax med potatis",
  [
    ["salmon", "lax"],
    ["potato", "potatis"],
  ],
  ["quick"],
);
const CREME = recipe(
  "creme",
  "Crème brûlée",
  "Crème brûlée",
  [
    ["cream", "grädde"],
    ["egg", "ägg"],
    ["egg", "ägg"],
  ],
  ["vegetarian"],
);
const SALAD = recipe(
  "salad",
  "Green salad",
  "Grön sallad",
  [
    ["lettuce", "sallad"],
    ["cucumber", "gurka"],
  ],
  ["vegetarian", "quick", "vegan"],
);

const FIXTURE = [MEATBALLS, SALMON, CREME, SALAD];

const pantry = (...entries: Array<[string, number?, boolean?]>): PantryEntry[] =>
  entries.map(([name, quantity = 1, expiring = false]) => ({ name, quantity, expiring }));

const opts: RankOptions = { query: "", tags: [], locale: "en", savedNames: [] };
const ids = (results: Array<{ id: string }>) => results.map((r) => r.id);

describe("normalizeForSearch", () => {
  it("folds accents, keeps å/ä/ö, lowercases and collapses whitespace", () => {
    expect(normalizeForSearch("  Crème   BRÛLÉE ")).toBe("creme brulee");
    expect(normalizeForSearch("Lök Äpple Öl Å")).toBe("lök äpple öl å");
    // A decomposed ö (o + combining diaeresis) must be treated like ö.
    expect(normalizeForSearch("lök")).toBe("lök");
  });
});

describe("rankCatalogRecipes filters", () => {
  it("filters by every selected tag (AND)", () => {
    const res = rankCatalogRecipes(FIXTURE, [], { ...opts, tags: ["vegetarian", "quick"] });
    expect(ids(res)).toEqual(["salad"]);
  });

  it("searches name and ingredient names in the current locale", () => {
    expect(ids(rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "sv", query: "lax" }))).toEqual(["salmon"]);
    expect(ids(rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "en", query: "salmon" }))).toEqual(["salmon"]);
    expect(rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "en", query: "lax" })).toEqual([]);
    // Ingredient-only match.
    expect(ids(rankCatalogRecipes(FIXTURE, [], { ...opts, query: "cucumber" }))).toEqual(["salad"]);
  });

  it("folds accents but not å/ä/ö", () => {
    expect(ids(rankCatalogRecipes(FIXTURE, [], { ...opts, query: "creme" }))).toEqual(["creme"]);
    expect(rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "sv", query: "lok" })).toEqual([]);
    expect(ids(rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "sv", query: "lök" }))).toEqual(["meatballs"]);
  });

  it("treats the query as literal text", () => {
    for (const query of ["(", "c++", ".*"]) {
      expect(() => rankCatalogRecipes(FIXTURE, [], { ...opts, query })).not.toThrow();
      expect(rankCatalogRecipes(FIXTURE, [], { ...opts, query })).toEqual([]);
    }
    expect(rankCatalogRecipes(FIXTURE, [], { ...opts, query: "   " })).toEqual(
      rankCatalogRecipes(FIXTURE, [], { ...opts, query: "" }),
    );
  });

  it("hides recipes already saved", () => {
    const res = rankCatalogRecipes(FIXTURE, [], {
      ...opts,
      locale: "sv",
      query: "köttbullar",
      savedNames: ["  KÖTTBULLAR "],
    });
    expect(res).toEqual([]);
    const withTags = rankCatalogRecipes(FIXTURE, [], { ...opts, locale: "sv", tags: [], savedNames: ["  KÖTTBULLAR "], query: "l" });
    expect(ids(withTags)).not.toContain("meatballs");
  });
});

describe("rankCatalogRecipes pantry matching", () => {
  it("ignores pantry items with quantity <= 0", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["milk", 0], ["onion", -1]), { ...opts, query: "meatballs" });
    expect(res[0].haveCount).toBe(0);
  });

  it("matches pantry names in either language", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["Mjölk"]), { ...opts, locale: "en" });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: "meatballs", name: "Meatballs", haveCount: 1, totalCount: 3 });
  });

  it("haveCount counts covered ingredients; one expiring item lists and boosts once", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["egg", 1, true]), opts);
    expect(res[0]).toMatchObject({ id: "creme", haveCount: 2, totalCount: 3, expiringMatches: ["egg"] });
  });

  it("localizes expiringMatches", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["egg", 1, true]), { ...opts, locale: "sv" });
    expect(res[0].expiringMatches).toEqual(["ägg"]);
    expect(res[0].name).toBe("Crème brûlée");
  });

  it("boosts expiring matches, capped at 3", () => {
    const base = [
      recipe("plain", "Aaa plain", "Aaa", [["a", "a"], ["b", "b"]]),
      recipe("urgent", "Zzz urgent", "Zzz", [["a", "a"], ["b", "b"]]),
    ];
    const res = rankCatalogRecipes(base, pantry(["a"], ["b", 1, false]), opts);
    expect(ids(res)).toEqual(["plain", "urgent"]); // tie, alphabetical
    const res2 = rankCatalogRecipes(base, pantry(["a", 1, true], ["b"]), opts);
    expect(ids(res2)).toEqual(["plain", "urgent"]); // still tied: both match the same items

    // Cap: A has 5 expiring matches on 5/10 coverage, B has 3 on 6/10. Capped
    // at 3, A scores 0.5 + 0.45 = 0.95 and B 0.6 + 0.45 = 1.05, so B leads.
    // Uncapped, A would be 0.5 + 0.75 = 1.25 and win.
    const ings = (names: string[]) => names.map((n): [string, string] => [n, n]);
    const A = recipe("A", "Aaa", "Aaa", ings(["a1", "a2", "a3", "a4", "a5", "u1", "u2", "u3", "u4", "u5"]));
    const B = recipe("B", "Zzz", "Zzz", ings(["b1", "b2", "b3", "p1", "p2", "p3", "u6", "u7", "u8", "u9"]));
    const p = pantry(
      ["a1", 1, true], ["a2", 1, true], ["a3", 1, true], ["a4", 1, true], ["a5", 1, true],
      ["b1", 1, true], ["b2", 1, true], ["b3", 1, true], ["p1"], ["p2"], ["p3"],
    );
    const mixed = rankCatalogRecipes([A, B], p, opts);
    expect(ids(mixed)).toEqual(["B", "A"]);
    expect(mixed[1].expiringMatches).toHaveLength(5);
  });

  it("an expiring match outranks equal coverage without one", () => {
    const x = recipe("x", "Aaa", "Aaa", [["a", "a"], ["b", "b"]]);
    const y = recipe("y", "Zzz", "Zzz", [["c", "c"], ["d", "d"]]);
    const res = rankCatalogRecipes([x, y], pantry(["a"], ["c", 1, true]), opts);
    expect(ids(res)).toEqual(["y", "x"]);
  });

  it("breaks ties by expiring count, then haveCount, then localized name", () => {
    // Equal scores: 1/2 + 0 vs 2/4 + 0 -> tie on score and expiring; haveCount decides.
    const small = recipe("small", "Aaa", "Aaa", [["a", "a"], ["b", "b"]]);
    const big = recipe("big", "Zzz", "Zzz", [["a", "a"], ["c", "c"], ["d", "d"], ["e", "e"]]);
    const big2 = recipe("big2", "Mmm", "Mmm", [["a", "a"], ["b", "b"], ["x", "x"], ["y", "y"]]);
    // small: 1/2; big: 1/4 (a only). Use pantry a,b -> small 2/2=1, big2 2/4, big 1/4.
    const res = rankCatalogRecipes([big, big2, small], pantry(["a"], ["b"]), opts);
    expect(ids(res)).toEqual(["small", "big2", "big"]);

    // Same score, same expiring count: more covered ingredients first.
    const two = recipe("two", "Zzz two", "Zzz two", [["a", "a"], ["b", "b"], ["x", "x"], ["y", "y"]]); // 2/4
    const one = recipe("one", "Aaa one", "Aaa one", [["a", "a"], ["x", "x"]]); // 1/2
    expect(ids(rankCatalogRecipes([one, two], pantry(["a"], ["b"]), opts))).toEqual(["two", "one"]);

    // Same score and haveCount: localized name, per locale.
    const p = recipe("p", "Banana", "Äpple", [["a", "a"]]);
    const q = recipe("q", "Apple", "Banan", [["a", "a"]]);
    expect(ids(rankCatalogRecipes([p, q], pantry(["a"]), opts))).toEqual(["q", "p"]);
    expect(ids(rankCatalogRecipes([p, q], pantry(["a"]), { ...opts, locale: "sv" }))).toEqual(["q", "p"]);
  });

  it("with no query and no tags, only recipes with haveCount >= 1", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["lettuce"]), opts);
    expect(ids(res)).toEqual(["salad"]);
  });

  it("with a query or tags, recipes with haveCount 0 are still listed", () => {
    const res = rankCatalogRecipes(FIXTURE, pantry(["lettuce"]), { ...opts, tags: ["quick"] });
    expect(ids(res)).toEqual(["salad", "salmon"]);
  });
});

describe("rankCatalogRecipes fallback and limit", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    recipe(`r${i}`, `Recipe ${String(i).padStart(2, "0")}`, `Recept ${String(i).padStart(2, "0")}`, [[`ing${i}`, `ing${i}`]]),
  );

  it("falls back to the featured set when nothing matches the pantry", () => {
    const res = rankCatalogRecipes(many, [], opts);
    expect(ids(res)).toEqual(many.slice(0, FEATURED_COUNT).map((r) => r.id));
    expect(res[0]).toMatchObject({ haveCount: 0, totalCount: 1 });
    // Also when the pantry is non-empty but matches nothing.
    expect(ids(rankCatalogRecipes(many, pantry(["unrelated"]), opts))).toHaveLength(FEATURED_COUNT);
  });

  it("featured fallback is capped by catalog length and skips saved recipes", () => {
    expect(rankCatalogRecipes(FIXTURE, [], opts)).toHaveLength(FIXTURE.length);
    const res = rankCatalogRecipes(many, [], { ...opts, savedNames: ["recipe 00"] });
    expect(ids(res)).toEqual(many.slice(1, FEATURED_COUNT).map((r) => r.id));
  });

  it("respects limit, default 30", () => {
    const all = pantry(...many.map((_, i) => [`ing${i}`] as [string]));
    expect(rankCatalogRecipes(many, all, opts)).toHaveLength(30);
    expect(rankCatalogRecipes(many, all, { ...opts, limit: 5 })).toHaveLength(5);
  });
});

describe("ingredientHaves", () => {
  it("reports per-ingredient coverage, ignoring empty stock", () => {
    expect(ingredientHaves(MEATBALLS, pantry(["Mjölk"], ["onion", 0]))).toEqual([false, true, false]);
  });
});
