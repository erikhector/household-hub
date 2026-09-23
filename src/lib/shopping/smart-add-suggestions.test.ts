import { describe, expect, it } from "vitest";
import {
  matchSmartAddInventoryItem,
  parseSmartAddInput,
  rankSmartAddSuggestions,
  rowsForSuggestion,
  splitSmartAddInput,
  type SmartAddCandidate,
} from "./smart-add-suggestions";

function candidate(overrides: Partial<SmartAddCandidate> & { id: string; name: string }): SmartAddCandidate {
  return { unit: "pcs", stockStatus: "in", lastPurchasedAt: null, ...overrides };
}

const names = (items: SmartAddCandidate[]) => items.map((item) => item.name);

describe("rankSmartAddSuggestions", () => {
  it("suggests nothing for an empty or punctuation-only query", () => {
    const candidates = [candidate({ id: "1", name: "Milk" })];
    expect(rankSmartAddSuggestions("", candidates)).toEqual([]);
    expect(rankSmartAddSuggestions("  !", candidates)).toEqual([]);
  });

  it("only returns names containing the query, case-insensitively", () => {
    const candidates = [
      candidate({ id: "1", name: "Mjölk" }),
      candidate({ id: "2", name: "Bröd" }),
      candidate({ id: "3", name: "Havremjölk" }),
    ];
    expect(names(rankSmartAddSuggestions("MJÖLK", candidates))).toEqual(["Mjölk", "Havremjölk"]);
  });

  it("ranks low/out-of-stock first, then previously bought by recency, then the rest", () => {
    const candidates = [
      candidate({ id: "other", name: "Milk powder" }),
      candidate({ id: "old", name: "Milk chocolate", lastPurchasedAt: 1_000 }),
      candidate({ id: "recent", name: "Milk (lactose free)", lastPurchasedAt: 5_000 }),
      candidate({ id: "low", name: "Milk 1L", stockStatus: "low" }),
      candidate({ id: "out", name: "Milk 3%", stockStatus: "out", lastPurchasedAt: 2_000 }),
    ];
    expect(rankSmartAddSuggestions("milk", candidates).map((c) => c.id)).toEqual([
      "out",
      "low",
      "recent",
      "old",
      "other",
    ]);
  });

  it("prefers a name that starts with the query over a later word over mid-word, within a tier", () => {
    const candidates = [
      candidate({ id: "mid", name: "Havremjölk", lastPurchasedAt: 9_000 }),
      candidate({ id: "word", name: "Laktosfri mjölk", lastPurchasedAt: 5_000 }),
      candidate({ id: "start", name: "Mjölk", lastPurchasedAt: 1_000 }),
    ];
    expect(rankSmartAddSuggestions("mjölk", candidates).map((c) => c.id)).toEqual(["start", "word", "mid"]);
  });

  it("puts an exact name first, whatever its stock or history", () => {
    const candidates = [
      candidate({ id: "milk", name: "Mjölk 3%", stockStatus: "out" }),
      candidate({ id: "flour", name: "Mjöl" }),
    ];
    expect(rankSmartAddSuggestions("mjöl", candidates).map((c) => c.id)).toEqual(["flour", "milk"]);
  });

  it("never lets match quality lift an item above a higher tier", () => {
    const candidates = [
      candidate({ id: "prefix-in-stock", name: "Mjölk 3%" }),
      candidate({ id: "mid-word-low", name: "Havremjölk", stockStatus: "low" }),
    ];
    expect(rankSmartAddSuggestions("mjölk", candidates).map((c) => c.id)).toEqual([
      "mid-word-low",
      "prefix-in-stock",
    ]);
  });

  it("drops excluded ids (already pending on the list) and caps at the limit", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ id: `${i}`, name: `Apple ${i}` }));
    const result = rankSmartAddSuggestions("apple", candidates, { limit: 3, excludeIds: new Set(["0"]) });
    expect(result.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });
});

describe("parseSmartAddInput", () => {
  it("turns the brief's example into three rows, leaving the unit out where none was typed", () => {
    expect(parseSmartAddInput("2 l mjölk, bröd, 6 ägg")).toEqual([
      { name: "mjölk", quantity: 2, unit: "l" },
      { name: "bröd", quantity: 1 },
      { name: "ägg", quantity: 6 },
    ]);
  });

  it("returns nothing for blank input", () => {
    expect(parseSmartAddInput(" , ")).toEqual([]);
  });
});

describe("splitSmartAddInput", () => {
  it("autocompletes only the segment after the last comma, with its count/unit parsed off", () => {
    expect(splitSmartAddInput("bröd, 2 l mj")).toEqual({
      head: "bröd",
      current: { name: "mj", quantity: 2, unit: "l" },
    });
  });

  it("has no current segment right after a comma", () => {
    expect(splitSmartAddInput("bröd, ")).toEqual({ head: "bröd", current: null });
  });
});

describe("rowsForSuggestion", () => {
  const milk = candidate({ id: "inv-milk", name: "Mjölk", unit: "l" });

  it("links the picked item, in its usual unit when none was typed", () => {
    expect(rowsForSuggestion("mjö", milk)).toEqual([
      { name: "Mjölk", quantity: 1, unit: "l", inventoryItemId: "inv-milk" },
    ]);
  });

  it("keeps a typed count/unit and every finished item before it", () => {
    expect(rowsForSuggestion("bröd, 6 ägg, 2 dl mj", milk)).toEqual([
      { name: "bröd", quantity: 1 },
      { name: "ägg", quantity: 6 },
      { name: "Mjölk", quantity: 2, unit: "dl", inventoryItemId: "inv-milk" },
    ]);
  });
});

describe("matchSmartAddInventoryItem", () => {
  const items = [
    { id: "flour", name: "Mjöl" },
    { id: "milk", name: "Mjölk 3%" },
    { id: "oat", name: "Havremjölk" },
    { id: "tomatoes", name: "Tomatoes" },
    { id: "choc", name: "Milk chocolate" },
  ];
  const match = (name: string, candidates = items) => matchSmartAddInventoryItem(name, candidates)?.id ?? null;

  it("prefers an exact (normalized) name", () => {
    expect(match("MJÖL")).toBe("flour");
  });

  it("converges a bare name on the one item that only adds a size/strength", () => {
    // Bigram overlap alone would pick Mjöl (0.86) over Mjölk 3% (0.8).
    expect(match("mjölk")).toBe("milk");
  });

  it("doesn't treat an extra word as a size", () => {
    expect(match("milk")).toBeNull();
  });

  it("creates rather than guesses when two items only add a size", () => {
    expect(match("mjölk", [...items, { id: "milk-light", name: "Mjölk 0,5%" }])).toBeNull();
  });

  it("falls back to a single confident fuzzy match for typos and plurals", () => {
    expect(match("tomatoe")).toBe("tomatoes");
    expect(match("kaffe")).toBeNull();
  });

  it("matches nothing for a blank name", () => {
    expect(match("  ")).toBeNull();
  });
});
