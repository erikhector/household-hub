import { describe, expect, it } from "vitest";
import {
  computeBasketStoreComparison,
  computeCheapestStoreComparisons,
  type PriceHistoryStoreRow,
} from "@/lib/cheapest-store-calc";

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

describe("computeBasketStoreComparison", () => {
  const milk = (store: string, price: number, date = new Date(2026, 0, 1)) =>
    row({ inventoryItemId: "milk", itemName: "Milk", store, price, date });
  const bread = (store: string, price: number, date = new Date(2026, 0, 1)) =>
    row({ inventoryItemId: "bread", itemName: "Bread", store, price, date });
  const coffee = (store: string, price: number, date = new Date(2026, 0, 1)) =>
    row({ inventoryItemId: "coffee", itemName: "Coffee", store, price, date });

  it("returns null when fewer than 2 pending items have prices from ≥2 stores", () => {
    // Bread has only one store, so milk is the only qualifying item.
    const rows = [milk("ICA", 20), milk("Coop", 18), bread("ICA", 30)];
    expect(computeBasketStoreComparison(rows, ["milk", "bread"])).toBeNull();
    expect(computeBasketStoreComparison([], [])).toBeNull();
  });

  it("only counts items that are pending on a list", () => {
    // Bread has cross-store history but isn't on the list.
    const rows = [milk("ICA", 20), milk("Coop", 18), bread("ICA", 30), bread("Coop", 25)];
    expect(computeBasketStoreComparison(rows, ["milk"])).toBeNull();
  });

  it("sums each store's basket and ranks the cheaper one first at equal coverage", () => {
    const rows = [milk("ICA", 20), milk("Coop", 18), bread("ICA", 30), bread("Coop", 35)];
    expect(computeBasketStoreComparison(rows, ["milk", "bread"])).toEqual({
      itemCount: 2,
      stores: [
        { store: "ICA", total: 50, pricedCount: 2 },
        { store: "Coop", total: 53, pricedCount: 2 },
      ],
    });
  });

  it("uses each store's most recent price, not its lowest", () => {
    const rows = [
      milk("ICA", 10, new Date(2026, 0, 1)),
      milk("ICA", 25, new Date(2026, 0, 9)),
      milk("Coop", 18),
      bread("ICA", 30),
      bread("Coop", 30),
    ];
    expect(computeBasketStoreComparison(rows, ["milk", "bread"])?.stores).toEqual([
      { store: "Coop", total: 48, pricedCount: 2 },
      { store: "ICA", total: 55, pricedCount: 2 },
    ]);
  });

  it("never ranks a partial total above a complete one, however cheap it looks", () => {
    const rows = [
      milk("ICA", 20),
      milk("Coop", 18),
      // Lidl has only a milk price — its 15 is a one-item total.
      milk("Lidl", 15),
      bread("ICA", 30),
      bread("Coop", 32),
      coffee("ICA", 60),
      coffee("Coop", 55),
    ];
    expect(computeBasketStoreComparison(rows, ["milk", "bread", "coffee"])).toEqual({
      itemCount: 3,
      stores: [
        { store: "Coop", total: 105, pricedCount: 3 },
        { store: "ICA", total: 110, pricedCount: 3 },
        { store: "Lidl", total: 15, pricedCount: 1 },
      ],
    });
  });

  it("orders partially priced stores by coverage before total", () => {
    const rows = [
      milk("ICA", 20),
      milk("Coop", 18),
      milk("Lidl", 5),
      bread("ICA", 30),
      bread("Coop", 32),
      coffee("ICA", 60),
      coffee("Willys", 50),
    ];
    const result = computeBasketStoreComparison(rows, ["milk", "bread", "coffee"]);
    expect(result?.stores.map((s) => [s.store, s.pricedCount])).toEqual([
      ["ICA", 3],
      ["Coop", 2],
      ["Lidl", 1],
      ["Willys", 1],
    ]);
  });

  it("counts an item that's on two lists once", () => {
    const rows = [milk("ICA", 20), milk("Coop", 18), bread("ICA", 30), bread("Coop", 35)];
    const result = computeBasketStoreComparison(rows, ["milk", "milk", "bread"]);
    expect(result?.itemCount).toBe(2);
    expect(result?.stores[0]).toEqual({ store: "ICA", total: 50, pricedCount: 2 });
  });

  it("groups store spellings case-insensitively and shows the most recent spelling", () => {
    const rows = [
      milk("ica", 20, new Date(2026, 0, 1)),
      milk("Coop", 18),
      bread("ICA ", 30, new Date(2026, 0, 5)),
      bread("Coop", 35),
    ];
    expect(computeBasketStoreComparison(rows, ["milk", "bread"])?.stores).toEqual([
      { store: "ICA", total: 50, pricedCount: 2 },
      { store: "Coop", total: 53, pricedCount: 2 },
    ]);
  });

  it("ignores rows with no store recorded", () => {
    const rows = [
      milk("ICA", 20),
      milk("Coop", 18),
      row({ inventoryItemId: "milk", store: null, price: 1 }),
      bread("ICA", 30),
      bread("Coop", 35),
    ];
    expect(computeBasketStoreComparison(rows, ["milk", "bread"])?.stores[0].total).toBe(50);
  });
});
