import { describe, expect, it } from "vitest";
import { buildCatalog, filterCatalogRows, parseCatalogFilter, unconvertibleUnits, type CatalogSourceItem } from "./catalog";

function source(id: string, overrides: Partial<CatalogSourceItem> = {}): CatalogSourceItem {
  return {
    id,
    name: id,
    category: "Pantry",
    unit: "pcs",
    quantity: 0,
    lowStockThreshold: 1,
    createdAt: new Date(2026, 0, 1),
    barcode: null,
    recipeCount: 0,
    listCount: 0,
    templateCount: 0,
    priceCount: 0,
    ...overrides,
  };
}

describe("unconvertibleUnits", () => {
  it("lists the recipe units neither the table nor the item's conversions reach", () => {
    expect(unconvertibleUnits({ unit: "pcs" }, ["g", "dl", "st", "kg", "dl"], [{ fromUnit: "g", factor: 0.001 }])).toEqual([
      "dl",
    ]);
    expect(unconvertibleUnits({ unit: "l" }, ["dl", "ml"], [])).toEqual([]);
  });
});

describe("buildCatalog", () => {
  const catalog = buildCatalog({
    items: [
      source("flour", { name: "Wheat flour", unit: "pcs", quantity: 1 }),
      source("egg", { name: "Egg", quantity: 12, recipeCount: 5 }),
      source("eggs", { name: "eggs", recipeCount: 2 }),
      source("bought", { name: "Salt" }),
      source("priced", { name: "Pepper", priceCount: 1 }),
      source("aagg", { name: "Ägg", priceCount: 1 }),
    ],
    purchasedCounts: new Map([["bought", 1]]),
    recipeUnits: [
      { inventoryItemId: "flour", unit: "g" },
      { inventoryItemId: "flour", unit: "dl" },
    ],
    conversions: [{ inventoryItemId: "flour", fromUnit: "g", factor: 0.0005 }],
    aliases: [],
    dismissals: [],
  });

  it("builds a row per item, in the order given, with its tags", () => {
    // The database sorts (as the inventory page does); re-sorting here put
    // "Ägg" first where the inventory has it last (UX-131).
    expect(catalog.rows.map((row) => row.name)).toEqual(["Wheat flour", "Egg", "eggs", "Salt", "Pepper", "Ägg"]);
    const flour = catalog.rows.find((row) => row.id === "flour")!;
    expect(flour.unitProblems).toEqual(["dl"]);
    expect(catalog.rows.find((row) => row.id === "bought")!.purchasedListCount).toBe(1);
  });

  it("finds the duplicate groups, keeper first", () => {
    expect(catalog.groups.map((group) => group.members.map((member) => member.id))).toEqual([["egg", "eggs"]]);
  });

  it("filters never stocked and unit problems", () => {
    expect(filterCatalogRows(catalog.rows, "neverStocked").map((row) => row.id)).toEqual(["eggs"]);
    expect(filterCatalogRows(catalog.rows, "unitProblems").map((row) => row.id)).toEqual(["flour"]);
    expect(filterCatalogRows(catalog.rows, "all")).toHaveLength(6);
  });
});

describe("parseCatalogFilter", () => {
  it("falls back to all", () => {
    expect(parseCatalogFilter("duplicates")).toBe("duplicates");
    expect(parseCatalogFilter("nope")).toBe("all");
    expect(parseCatalogFilter(undefined)).toBe("all");
  });
});
