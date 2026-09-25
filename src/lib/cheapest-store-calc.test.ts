import { describe, expect, it } from "vitest";
import { computeCheapestStoreComparisons, type PriceHistoryStoreRow } from "@/lib/cheapest-store-calc";

function row(overrides: Partial<PriceHistoryStoreRow>): PriceHistoryStoreRow {
  return {
    inventoryItemId: "item-1",
    itemName: "Milk",
    price: 20,
    store: "ICA",
    date: new Date(2026, 0, 1),
    ...overrides,
  };
}

describe("computeCheapestStoreComparisons", () => {
  it("leaves out an item with no store recorded at all", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: null }),
      row({ store: null, price: 25 }),
    ]);
    expect(result).toEqual([]);
  });

  it("leaves out an item with only one distinct store on record", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ICA", price: 20, date: new Date(2026, 0, 1) }),
      row({ store: "ICA", price: 22, date: new Date(2026, 0, 5) }),
    ]);
    expect(result).toEqual([]);
  });

  it("picks the store with the cheapest last recorded price once ≥2 distinct stores exist", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ICA", price: 24, date: new Date(2026, 0, 1) }),
      row({ store: "Coop", price: 19, date: new Date(2026, 0, 2) }),
    ]);
    expect(result).toEqual([
      { id: "item-1", name: "Milk", cheapestStore: "Coop", cheapestPrice: 19, storeCount: 2 },
    ]);
  });

  it("uses each store's most recent price, not its lowest ever price", () => {
    const result = computeCheapestStoreComparisons([
      // ICA used to be cheaper, but its price has since gone up — the most
      // recent ICA row should be the one compared, not this stale low one.
      row({ store: "ICA", price: 10, date: new Date(2026, 0, 1) }),
      row({ store: "ICA", price: 30, date: new Date(2026, 0, 10) }),
      row({ store: "Coop", price: 20, date: new Date(2026, 0, 5) }),
    ]);
    expect(result).toEqual([
      { id: "item-1", name: "Milk", cheapestStore: "Coop", cheapestPrice: 20, storeCount: 2 },
    ]);
  });

  it("is order-independent — the latest date wins regardless of row order in the input", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ICA", price: 30, date: new Date(2026, 0, 10) }),
      row({ store: "ICA", price: 10, date: new Date(2026, 0, 1) }),
      row({ store: "Coop", price: 20, date: new Date(2026, 0, 5) }),
    ]);
    expect(result[0]).toEqual({
      id: "item-1",
      name: "Milk",
      cheapestStore: "Coop",
      cheapestPrice: 20,
      storeCount: 2,
    });
  });

  it("tracks storeCount across more than two stores", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ICA", price: 24 }),
      row({ store: "Coop", price: 19 }),
      row({ store: "Hemköp", price: 22 }),
    ]);
    expect(result).toEqual([
      { id: "item-1", name: "Milk", cheapestStore: "Coop", cheapestPrice: 19, storeCount: 3 },
    ]);
  });

  it("handles multiple items independently and sorts the result by item name", () => {
    const result = computeCheapestStoreComparisons([
      row({ inventoryItemId: "item-2", itemName: "Zucchini", store: "ICA", price: 15 }),
      row({ inventoryItemId: "item-2", itemName: "Zucchini", store: "Coop", price: 12 }),
      row({ inventoryItemId: "item-1", itemName: "Milk", store: "ICA", price: 24 }),
      row({ inventoryItemId: "item-1", itemName: "Milk", store: "Coop", price: 19 }),
    ]);
    expect(result.map((c) => c.name)).toEqual(["Milk", "Zucchini"]);
  });

  it("treats store names differing only in case or whitespace as the same store", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ICA", price: 24, date: new Date(2026, 0, 1) }),
      row({ store: "ica ", price: 21, date: new Date(2026, 0, 3) }),
    ]);
    expect(result).toEqual([]);
  });

  it("shows the most recent spelling of a store once it's compared against another", () => {
    const result = computeCheapestStoreComparisons([
      row({ store: "ica maxi", price: 18, date: new Date(2026, 0, 1) }),
      row({ store: "ICA Maxi", price: 17, date: new Date(2026, 0, 4) }),
      row({ store: "Coop", price: 19, date: new Date(2026, 0, 2) }),
    ]);
    expect(result).toEqual([
      { id: "item-1", name: "Milk", cheapestStore: "ICA Maxi", cheapestPrice: 17, storeCount: 2 },
    ]);
  });
});
