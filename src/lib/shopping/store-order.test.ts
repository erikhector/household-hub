import { describe, expect, it } from "vitest";
import {
  applySubsetReorder,
  compareCategoryKeys,
  defaultPosition,
  EMPTY_STORE_ORDER,
  effectiveOrder,
  learnFromCheckOffs,
  LEARNING_RATE,
  nudgeLearnedOrder,
  observedCategoryRanks,
  parseLearnedOrder,
  storeOrderSortKey,
  type CheckOff,
  type StoreOrder,
} from "@/lib/shopping/store-order";

// One trip, ticked off one row a minute in the given order.
const trip = (...keys: (string | null)[]): CheckOff[] =>
  keys.map((key, i) => ({ key, at: new Date(Date.UTC(2026, 8, 25, 10, i)) }));

const order = (learned: Record<string, number> = {}, manual: string[] = []): StoreOrder => ({ learned, manual });

describe("defaultPosition", () => {
  it("puts known categories at their AUTO_CATEGORY_KEYS slot midpoints, in order", () => {
    expect(defaultPosition("auto:produce")).toBeCloseTo(0.5 / 9);
    expect(defaultPosition("auto:bathroom")).toBeCloseTo(8.5 / 9);
    expect(defaultPosition("auto:produce")).toBeLessThan(defaultPosition("auto:dairy"));
  });

  it("puts a custom category after every known one", () => {
    expect(defaultPosition("garage")).toBe(1);
    expect(defaultPosition("garage")).toBeGreaterThan(defaultPosition("auto:bathroom"));
  });
});

describe("parseLearnedOrder", () => {
  it("keeps finite numbers keyed by non-empty strings", () => {
    expect(parseLearnedOrder({ "auto:dairy": 0.2, garage: 1 })).toEqual({ "auto:dairy": 0.2, garage: 1 });
  });

  it("drops malformed entries instead of failing", () => {
    expect(parseLearnedOrder({ a: "0.2", b: null, c: Number.NaN, d: 0.5, "": 0.1 })).toEqual({ d: 0.5 });
  });

  it("treats null, arrays and primitives as nothing learned", () => {
    expect(parseLearnedOrder(null)).toEqual({});
    expect(parseLearnedOrder(undefined)).toEqual({});
    expect(parseLearnedOrder([0.1, 0.2])).toEqual({});
    expect(parseLearnedOrder("x")).toEqual({});
  });
});

describe("storeOrderSortKey / compareCategoryKeys", () => {
  it("with nothing stored, reproduces AUTO-3's fixed order, customs alphabetical after", () => {
    const keys = ["zephyr", "auto:frozen", "basement", "auto:produce", "auto:dairy"];
    expect([...keys].sort((a, b) => compareCategoryKeys(a, b, EMPTY_STORE_ORDER))).toEqual([
      "auto:produce",
      "auto:dairy",
      "auto:frozen",
      "basement",
      "zephyr",
    ]);
  });

  it("uses a learned position over the default", () => {
    const o = order({ "auto:frozen": 0 });
    expect(compareCategoryKeys("auto:frozen", "auto:produce", o)).toBeLessThan(0);
  });

  it("lets a manual order beat anything learned", () => {
    const o = order({ "auto:frozen": 0, "auto:produce": 0.99 }, ["auto:produce", "auto:frozen"]);
    expect(storeOrderSortKey("auto:produce", o)).toEqual([0, 0]);
    expect(compareCategoryKeys("auto:produce", "auto:frozen", o)).toBeLessThan(0);
  });

  it("puts a category the manual order doesn't mention after every arranged one", () => {
    const o = order({ "new shelf": 0 }, ["auto:bathroom", "auto:produce"]);
    expect(compareCategoryKeys("auto:produce", "new shelf", o)).toBeLessThan(0);
    // …but unmentioned ones still sort among themselves by learned/default.
    expect(compareCategoryKeys("new shelf", "auto:dairy", o)).toBeLessThan(0);
  });
});

describe("observedCategoryRanks", () => {
  it("ranks categories by when they were ticked off, not by list order", () => {
    const checkOffs: CheckOff[] = [
      { key: "auto:dairy", at: new Date(3000) },
      { key: "auto:produce", at: new Date(1000) },
    ];
    const ranks = observedCategoryRanks(checkOffs);
    expect(ranks.get("auto:produce")).toBeCloseTo(0.25);
    expect(ranks.get("auto:dairy")).toBeCloseTo(0.75);
  });

  it("averages a category's rows", () => {
    // Slots 0.125, 0.375, 0.625, 0.875.
    const ranks = observedCategoryRanks(trip("auto:produce", "auto:dairy", "auto:produce", "auto:frozen"));
    expect(ranks.get("auto:produce")).toBeCloseTo(0.375);
    expect(ranks.get("auto:dairy")).toBeCloseTo(0.375);
    expect(ranks.get("auto:frozen")).toBeCloseTo(0.875);
  });

  it("ignores Other rows entirely", () => {
    const ranks = observedCategoryRanks(trip(null, "auto:frozen", null, "auto:produce"));
    expect([...ranks.keys()].sort()).toEqual(["auto:frozen", "auto:produce"]);
    expect(ranks.get("auto:frozen")).toBeCloseTo(0.25);
  });

  it("learns nothing from a trip that touched fewer than two categories", () => {
    expect(observedCategoryRanks([]).size).toBe(0);
    expect(observedCategoryRanks(trip("auto:dairy", "auto:dairy", null)).size).toBe(0);
  });

  it("keeps list order for rows ticked in the same instant", () => {
    const at = new Date(5000);
    const ranks = observedCategoryRanks([
      { key: "auto:frozen", at },
      { key: "auto:produce", at },
    ]);
    expect(ranks.get("auto:frozen")).toBeLessThan(ranks.get("auto:produce")!);
  });
});

describe("nudgeLearnedOrder", () => {
  it("moves an observed category LEARNING_RATE of the way toward its observation", () => {
    const next = nudgeLearnedOrder({ "auto:dairy": 0.2 }, new Map([["auto:dairy", 0.8]]));
    expect(next["auto:dairy"]).toBeCloseTo(0.2 + LEARNING_RATE * 0.6);
  });

  it("starts a never-seen category from its default position", () => {
    const next = nudgeLearnedOrder({}, new Map([["auto:produce", 1]]), 0.5);
    expect(next["auto:produce"]).toBeCloseTo((0.5 / 9 + 1) / 2, 3);
    const custom = nudgeLearnedOrder({}, new Map([["garage", 0]]), 0.5);
    expect(custom.garage).toBe(0.5);
  });

  it("leaves categories the trip didn't touch alone, and doesn't mutate its input", () => {
    const learned = { "auto:frozen": 0.4, "auto:dairy": 0.2 };
    const next = nudgeLearnedOrder(learned, new Map([["auto:dairy", 0.8]]));
    expect(next["auto:frozen"]).toBe(0.4);
    expect(learned["auto:dairy"]).toBe(0.2);
  });

  it("rounds to 4 decimals", () => {
    const next = nudgeLearnedOrder({ a: 0.1 }, new Map([["a", 0.2]]), 1 / 3);
    expect(next.a).toBe(0.1333);
  });
});

describe("learnFromCheckOffs", () => {
  it("returns null when the trip taught nothing, so the caller can skip the write", () => {
    expect(learnFromCheckOffs({ a: 0.5 }, trip("auto:dairy"))).toBeNull();
  });

  it("converges on a household's real walk order after a few consistent trips", () => {
    // This store has the freezers by the door and produce at the back —
    // the opposite of the default guess.
    let learned: Record<string, number> = {};
    const walk = () => trip("auto:frozen", "auto:dairy", "auto:produce");
    const sorted = () =>
      ["auto:produce", "auto:dairy", "auto:frozen"].sort((a, b) => compareCategoryKeys(a, b, order(learned)));

    expect(sorted()).toEqual(["auto:produce", "auto:dairy", "auto:frozen"]);
    for (let i = 0; i < 4; i++) learned = learnFromCheckOffs(learned, walk())!;
    expect(sorted()).toEqual(["auto:frozen", "auto:dairy", "auto:produce"]);
  });

  it("isn't flipped by one odd trip once an order is established", () => {
    let learned: Record<string, number> = {};
    for (let i = 0; i < 6; i++) learned = learnFromCheckOffs(learned, trip("auto:frozen", "auto:produce"))!;
    learned = learnFromCheckOffs(learned, trip("auto:produce", "auto:frozen"))!;
    expect(compareCategoryKeys("auto:frozen", "auto:produce", order(learned))).toBeLessThan(0);
  });
});

describe("effectiveOrder", () => {
  it("covers every known key plus learned, manual and extra keys, in walk order", () => {
    const keys = effectiveOrder(order({ garage: 0 }, []), ["attic"]);
    expect(keys[0]).toBe("garage");
    expect(keys).toContain("attic");
    expect(keys).toContain("auto:bathroom");
    expect(keys.indexOf("auto:produce")).toBeLessThan(keys.indexOf("auto:dairy"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("applySubsetReorder", () => {
  it("reorders only the given keys, within the slots they already held", () => {
    expect(applySubsetReorder(["a", "b", "c", "d", "e"], ["d", "b"])).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("is the identity when the subset keeps its order", () => {
    expect(applySubsetReorder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("appends keys the full order lacks and ignores duplicates", () => {
    expect(applySubsetReorder(["a", "b"], ["b", "x", "b", "a"])).toEqual(["b", "a", "x"]);
  });
});
