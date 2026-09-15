import { describe, expect, it } from "vitest";
import { getStockStatus } from "@/lib/stock-status";

describe("getStockStatus", () => {
  it("returns 'out' when quantity is zero or negative", () => {
    expect(getStockStatus(0, 5)).toBe("out");
    expect(getStockStatus(-1, 5)).toBe("out");
  });

  it("returns 'low' when quantity is above zero but below the threshold", () => {
    expect(getStockStatus(1, 5)).toBe("low");
    expect(getStockStatus(4, 5)).toBe("low");
  });

  it("returns 'in' when quantity is at or above the threshold", () => {
    expect(getStockStatus(5, 5)).toBe("in");
    expect(getStockStatus(6, 5)).toBe("in");
  });

  it("treats a zero threshold as 'in stock' for any positive quantity", () => {
    expect(getStockStatus(1, 0)).toBe("in");
    expect(getStockStatus(0, 0)).toBe("out");
  });
});
