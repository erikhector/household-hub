import { describe, expect, it } from "vitest";
import { itemNameSimilarity } from "@/lib/item-matching";
import {
  compareKeeper,
  findDuplicateGroups,
  findDuplicateOfName,
  FUZZY_MIN_SCORE,
  isNeverStocked,
  sortedPair,
  type DuplicateItem,
} from "./duplicates";

let seq = 0;
function item(name: string, overrides: Partial<DuplicateItem> = {}): DuplicateItem {
  seq += 1;
  return {
    id: overrides.id ?? `item-${seq}`,
    name,
    unit: "pcs",
    quantity: 0,
    createdAt: new Date(2026, 0, 1, 0, seq),
    barcode: null,
    recipeCount: 0,
    listCount: 0,
    templateCount: 0,
    priceCount: 0,
    purchasedListCount: 0,
    ...overrides,
  };
}

const groupNames = (groups: ReturnType<typeof findDuplicateGroups>) =>
  groups.map((group) => group.members.map((member) => member.name));

describe("findDuplicateGroups", () => {
  it("pairs equal normalized names", () => {
    const groups = findDuplicateGroups([item("Mjölk"), item("mjölk."), item("Bread")], [], []);
    expect(groupNames(groups)).toEqual([["Mjölk", "mjölk."]]);
    expect(groups[0].strength).toBe(1);
  });

  it("pairs names that are equal after the plural fold", () => {
    const groups = findDuplicateGroups([item("Egg"), item("eggs"), item("Tomat"), item("tomater")], [], []);
    expect(groupNames(groups).map((names) => [...names].sort())).toEqual([
      ["Egg", "eggs"],
      ["Tomat", "tomater"],
    ]);
  });

  it("pairs an item whose name is an alias of another item", () => {
    const flour = item("Wheat flour", { id: "flour" });
    const groups = findDuplicateGroups(
      [flour, item("Vetemjöl", { id: "vetemjol" })],
      [{ normalizedName: "vetemjöl", inventoryItemId: "flour" }],
      [],
    );
    expect(groupNames(groups)).toHaveLength(1);
    expect(groups[0].members.map((member) => member.id).sort()).toEqual(["flour", "vetemjol"]);
  });

  it("ignores an untracked alias and one pointing at an unknown item", () => {
    const groups = findDuplicateGroups(
      [item("Water bottle"), item("Ice cubes")],
      [
        { normalizedName: "ice cubes", inventoryItemId: null },
        { normalizedName: "water bottle", inventoryItemId: "gone" },
      ],
      [],
    );
    expect(groups).toEqual([]);
  });

  it("pairs a fuzzy score of at least 0.8, scored like itemNameSimilarity", () => {
    const close = ["Crème fraiche", "crème fraiche lätt"] as const;
    const far = ["Crème fraiche", "Cream cheese"] as const;
    expect(itemNameSimilarity(...close)).toBeGreaterThanOrEqual(FUZZY_MIN_SCORE);
    expect(itemNameSimilarity(...far)).toBeLessThan(FUZZY_MIN_SCORE);

    const groups = findDuplicateGroups([item(close[0]), item(close[1]), item(far[1])], [], []);
    expect(groupNames(groups)).toEqual([[close[0], close[1]]]);
    expect(groups[0].strength).toBeCloseTo(itemNameSimilarity(...close));
  });

  it("does not pair unrelated or short names", () => {
    expect(findDuplicateGroups([item("a"), item("b"), item("Milk"), item("Salt")], [], [])).toEqual([]);
  });

  it("skips a dismissed pair, whichever way round it was stored", () => {
    const egg = item("Egg", { id: "b-egg" });
    const eggs = item("eggs", { id: "a-eggs" });
    expect(findDuplicateGroups([egg, eggs], [], [{ itemAId: "b-egg", itemBId: "a-eggs" }])).toEqual([]);
    expect(findDuplicateGroups([egg, eggs], [], [{ itemAId: "a-eggs", itemBId: "b-egg" }])).toEqual([]);
  });

  it("joins pairs into one group (union-find) and keeps other pairs apart", () => {
    const groups = findDuplicateGroups(
      [
        item("Egg", { id: "egg" }),
        item("eggs", { id: "eggs" }),
        item("Äggs", { id: "agg-plural" }),
        item("Ägg", { id: "agg" }),
        item("Salt", { id: "salt" }),
      ],
      [{ normalizedName: "ägg", inventoryItemId: "egg" }],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((member) => member.id).sort()).toEqual(["agg", "agg-plural", "egg", "eggs"]);
  });

  it("still groups through a third item when only one pair was dismissed", () => {
    const groups = findDuplicateGroups(
      [item("Egg", { id: "a" }), item("eggs", { id: "b" }), item("EGG", { id: "c" })],
      [],
      [{ itemAId: "a", itemBId: "b" }],
    );
    expect(groups[0].members.map((member) => member.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("sorts groups by their strongest pair, then by keeper name", () => {
    const groups = findDuplicateGroups(
      [item("Tomat"), item("tomater"), item("Milk"), item("milk"), item("Bread"), item("bread")],
      [],
      [],
    );
    expect(groups.map((group) => group.members[0].name.toLowerCase())).toEqual(["bread", "milk", "tomat"]);
    expect(groups.map((group) => group.strength)).toEqual([1, 1, 0.95]);
  });

  it("tags each member", () => {
    const groups = findDuplicateGroups(
      [
        item("Egg", { quantity: 12, barcode: "123", recipeCount: 5 }),
        item("eggs", { recipeCount: 2 }),
        item("EGG", { priceCount: 1 }),
      ],
      [],
      [],
    );
    expect(
      groups[0].members.map(({ name, neverStocked, recipeCount, barcode, unit }) => ({
        name,
        neverStocked,
        recipeCount,
        barcode,
        unit,
      })),
    ).toEqual([
      { name: "Egg", neverStocked: false, recipeCount: 5, barcode: "123", unit: "pcs" },
      { name: "eggs", neverStocked: true, recipeCount: 2, barcode: null, unit: "pcs" },
      { name: "EGG", neverStocked: false, recipeCount: 0, barcode: null, unit: "pcs" },
    ]);
  });

  it("stays fast for a household with about 2,000 items", () => {
    const words = [
      "milk", "bread", "flour", "sugar", "salt", "pepper", "butter", "cheese", "tomato", "onion",
      "garlic", "rice", "pasta", "oil", "vinegar", "honey", "jam", "tea", "coffee", "cocoa",
      "yoghurt", "cream", "egg", "apple", "banana", "carrot", "potato", "lemon", "lime", "orange",
      "mjölk", "smör", "ost", "grädde", "lök", "vitlök", "ris", "kaffe", "socker", "vetemjöl",
    ];
    const qualifiers = [
      "organic", "whole", "light", "dark", "red", "green", "frozen", "fresh", "dried", "smoked",
      "spicy", "sweet", "sour", "white", "brown", "large", "small", "baby", "wild", "roasted",
      "ekologisk", "färsk", "fryst", "rökt", "stor", "liten", "vit", "mörk", "söt", "ljus",
      "canned", "sliced", "grated", "ground", "crushed", "chopped", "mild", "strong", "extra", "plain",
      "ice", "hot", "cold", "raw", "salted", "unsalted",
    ];
    const items: DuplicateItem[] = [];
    for (const qualifier of qualifiers) for (const word of words) items.push(item(`${qualifier} ${word}`));
    expect(items.length).toBeGreaterThanOrEqual(1800);

    const started = performance.now();
    const groups = findDuplicateGroups(items, [], []);
    const elapsed = performance.now() - started;
    expect(groups.length).toBeGreaterThan(0);
    // Generous for a slow CI machine. Comparing every pair with
    // itemNameSimilarity takes a few seconds here.
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("compareKeeper", () => {
  it("prefers the item with stock, then more history, then the oldest", () => {
    const old = item("a", { createdAt: new Date(2020, 0, 1) });
    const young = item("b", { createdAt: new Date(2025, 0, 1) });
    const historied = item("c", { createdAt: new Date(2025, 0, 1), recipeCount: 1, priceCount: 2 });
    const moreHistory = item("d", { createdAt: new Date(2025, 0, 1), listCount: 2, templateCount: 2 });
    const stocked = item("e", { quantity: 1, createdAt: new Date(2026, 0, 1) });
    expect([young, old, historied, moreHistory, stocked].sort(compareKeeper).map((i) => i.name)).toEqual([
      "e",
      "d",
      "c",
      "a",
      "b",
    ]);
  });
});

describe("isNeverStocked", () => {
  it("needs no stock, no price and no bought list row", () => {
    const base = { quantity: 0, priceCount: 0, purchasedListCount: 0 };
    expect(isNeverStocked(base)).toBe(true);
    expect(isNeverStocked({ ...base, quantity: 1 })).toBe(false);
    expect(isNeverStocked({ ...base, priceCount: 1 })).toBe(false);
    expect(isNeverStocked({ ...base, purchasedListCount: 1 })).toBe(false);
  });
});

describe("sortedPair", () => {
  it("stores the smaller id first", () => {
    expect(sortedPair("b", "a")).toEqual(["a", "b"]);
    expect(sortedPair("a", "b")).toEqual(["a", "b"]);
  });
});

describe("findDuplicateOfName (UX-126)", () => {
  const pantry = [
    { id: "butter", name: "Smör" },
    { id: "banana", name: "Banan" },
    { id: "milk", name: "Mjölk" },
  ];

  it("matches the same name regardless of case and punctuation", () => {
    expect(findDuplicateOfName("smör", pantry)?.id).toBe("butter");
    expect(findDuplicateOfName("  SMÖR. ", pantry)?.id).toBe("butter");
  });

  it("matches a plural against the singular and back", () => {
    expect(findDuplicateOfName("Bananer", pantry)?.id).toBe("banana");
    expect(findDuplicateOfName("Banan", [{ id: "p", name: "Bananer" }])?.id).toBe("p");
  });

  it("matches a close typo by the catalog's fuzzy threshold", () => {
    expect(findDuplicateOfName("Mjölkk", pantry)?.id).toBe("milk");
  });

  it("prefers an exact name over a fold or fuzzy one", () => {
    const items = [
      { id: "plural", name: "Bananer" },
      { id: "exact", name: "Banan" },
    ];
    expect(findDuplicateOfName("banan", items)?.id).toBe("exact");
  });

  it("returns null for an unrelated or empty name", () => {
    expect(findDuplicateOfName("Pasta", pantry)).toBeNull();
    expect(findDuplicateOfName("  ", pantry)).toBeNull();
    expect(findDuplicateOfName("Smör", [])).toBeNull();
  });
});
