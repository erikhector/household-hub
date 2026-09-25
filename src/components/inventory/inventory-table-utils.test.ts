import { describe, expect, it } from "vitest";
import { groupItems, groupKeyFor, matchesUpdatedFilter, type InventoryItemRow } from "./inventory-table-utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const dict = { noLocation: "No location" } as Dictionary["inventory"];

function item(overrides: Partial<InventoryItemRow>): InventoryItemRow {
  return {
    id: "item-1",
    name: "Milk",
    category: "Dairy",
    quantity: 2,
    unit: "l",
    lowStockThreshold: 1,
    location: "Fridge",
    expiresAt: null,
    expiresAtEstimated: false,
    shelfLifeDays: null,
    updatedAt: new Date(2026, 8, 1),
    updatedByUserId: null,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("matchesUpdatedFilter", () => {
  const now = new Date(2026, 8, 10).getTime();

  it("matches everything for 'all'", () => {
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 200 * DAY_MS) }), "all", now)).toBe(true);
  });

  it("'today' matches items updated within the last day", () => {
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - DAY_MS / 2) }), "today", now)).toBe(true);
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 2 * DAY_MS) }), "today", now)).toBe(false);
  });

  it("'week' matches items updated within the last 7 days", () => {
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 6 * DAY_MS) }), "week", now)).toBe(true);
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 8 * DAY_MS) }), "week", now)).toBe(false);
  });

  it("'stale30' matches items untouched for at least 30 days", () => {
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 30 * DAY_MS) }), "stale30", now)).toBe(true);
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 29 * DAY_MS) }), "stale30", now)).toBe(false);
  });

  it("'stale90' matches items untouched for at least 90 days", () => {
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 90 * DAY_MS) }), "stale90", now)).toBe(true);
    expect(matchesUpdatedFilter(item({ updatedAt: new Date(now - 89 * DAY_MS) }), "stale90", now)).toBe(false);
  });
});

describe("groupKeyFor", () => {
  it("returns an empty key when not grouping", () => {
    expect(groupKeyFor(item({}), "none", dict)).toBe("");
  });

  it("groups by category", () => {
    expect(groupKeyFor(item({ category: "Dairy" }), "category", dict)).toBe("Dairy");
  });

  it("groups by location, falling back to the dict's 'no location' label", () => {
    expect(groupKeyFor(item({ location: "Fridge" }), "location", dict)).toBe("Fridge");
    expect(groupKeyFor(item({ location: null }), "location", dict)).toBe(dict.noLocation);
    expect(groupKeyFor(item({ location: "" }), "location", dict)).toBe(dict.noLocation);
  });

  it("groups by category and location combined", () => {
    expect(groupKeyFor(item({ category: "Dairy", location: "Fridge" }), "both", dict)).toBe("Dairy • Fridge");
    expect(groupKeyFor(item({ category: "Dairy", location: null }), "both", dict)).toBe(
      `Dairy • ${dict.noLocation}`,
    );
  });
});

describe("groupItems", () => {
  it("puts everything in a single unkeyed group when not grouping", () => {
    const items = [item({ id: "a", category: "Dairy" }), item({ id: "b", category: "Produce" })];
    expect(groupItems(items, "none", dict)).toEqual([{ key: "", items }]);
  });

  it("groups items by category, sorted alphabetically by key", () => {
    const milk = item({ id: "a", category: "Dairy" });
    const apple = item({ id: "b", category: "Produce" });
    const cheese = item({ id: "c", category: "Dairy" });

    const groups = groupItems([milk, apple, cheese], "category", dict);

    expect(groups).toEqual([
      { key: "Dairy", items: [milk, cheese] },
      { key: "Produce", items: [apple] },
    ]);
  });

  it("preserves each group's incoming item order", () => {
    const second = item({ id: "b", category: "Dairy", name: "Cheese" });
    const first = item({ id: "a", category: "Dairy", name: "Milk" });

    const groups = groupItems([second, first], "category", dict);

    expect(groups).toEqual([{ key: "Dairy", items: [second, first] }]);
  });

  it("groups unlocated items under the dict's 'no location' label", () => {
    const located = item({ id: "a", location: "Pantry" });
    const unlocated = item({ id: "b", location: null });

    const groups = groupItems([located, unlocated], "location", dict);

    expect(groups).toEqual([
      { key: dict.noLocation, items: [unlocated] },
      { key: "Pantry", items: [located] },
    ]);
  });
});
