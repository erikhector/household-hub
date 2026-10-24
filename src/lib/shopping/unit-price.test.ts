import { describe, expect, it } from "vitest";
import { defaultLineEstimate, unitPriceOf } from "./unit-price";

describe("unitPriceOf", () => {
  it("divides the line price by the quantity it was paid for", () => {
    expect(unitPriceOf(45, 3)).toBe(15);
    expect(unitPriceOf(24, 1)).toBe(24);
  });

  it("keeps enough precision to scale back up to the cent", () => {
    expect(defaultLineEstimate(unitPriceOf(10, 3), 3)).toBe(10);
  });

  it("returns the price untouched for an unusable quantity", () => {
    expect(unitPriceOf(45, 0)).toBe(45);
    expect(unitPriceOf(45, Number.NaN)).toBe(45);
  });
});

describe("defaultLineEstimate", () => {
  it("scales the unit price by the row quantity", () => {
    expect(defaultLineEstimate(15, 1)).toBe(15);
    expect(defaultLineEstimate(15, 2)).toBe(30);
    expect(defaultLineEstimate(1.25, 0.5)).toBe(0.63);
  });

  it("is undefined without a known price", () => {
    expect(defaultLineEstimate(null, 2)).toBeUndefined();
    expect(defaultLineEstimate(undefined, 2)).toBeUndefined();
  });
});
