import { describe, expect, it } from "vitest";
import { computeStockValue, type StockValueCandidate } from "@/lib/inventory/stock-value";

function item(overrides: Partial<StockValueCandidate> = {}): StockValueCandidate {
  return { quantity: 1, lastKnownPrice: 20, ...overrides };
}

describe("computeStockValue", () => {
  it("returns an empty summary for no items", () => {
    expect(computeStockValue([])).toEqual({
      value: 0,
      pricedCount: 0,
      unpricedCount: 0,
      inStockCount: 0,
    });
  });

  it("values each item once at its last known price, not price × quantity", () => {
    const summary = computeStockValue([item({ quantity: 500, lastKnownPrice: 24.5 })]);
    expect(summary.value).toBe(24.5);
    expect(summary.pricedCount).toBe(1);
  });

  it("sums priced items and rounds to cents", () => {
    const summary = computeStockValue([
      item({ lastKnownPrice: 0.1 }),
      item({ lastKnownPrice: 0.2 }),
      item({ lastKnownPrice: 12.345 }),
    ]);
    expect(summary.value).toBe(12.65);
    expect(summary.pricedCount).toBe(3);
    expect(summary.inStockCount).toBe(3);
  });

  it("counts unpriced items without adding to the value", () => {
    const summary = computeStockValue([
      item({ lastKnownPrice: 30 }),
      item({ lastKnownPrice: null }),
      item({ lastKnownPrice: 0 }),
    ]);
    expect(summary).toEqual({ value: 30, pricedCount: 1, unpricedCount: 2, inStockCount: 3 });
  });

  it("ignores items with nothing on hand, priced or not", () => {
    const summary = computeStockValue([
      item({ quantity: 0, lastKnownPrice: 99 }),
      item({ quantity: 0, lastKnownPrice: null }),
      item({ quantity: -1, lastKnownPrice: 5 }),
      item({ quantity: 0.5, lastKnownPrice: 10 }),
    ]);
    expect(summary).toEqual({ value: 10, pricedCount: 1, unpricedCount: 0, inStockCount: 1 });
  });
});
