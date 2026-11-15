import { describe, expect, it } from "vitest";
import { renderedScale } from "./use-flip-list";

describe("renderedScale", () => {
  it("is the ratio of the drawn width to the laid-out one", () => {
    // The page behind an open sheet on a phone (sheet-indent.tsx).
    expect(renderedScale(357.2, 380)).toBeCloseTo(0.94, 5);
    expect(renderedScale(760, 380)).toBe(2);
  });

  it("is 1 when nothing above the list is transformed", () => {
    expect(renderedScale(380, 380)).toBe(1);
  });

  it("reads a rounding difference between the two widths as no scale", () => {
    // getBoundingClientRect is exact, the computed width has three decimals.
    expect(renderedScale(380.015625, 380.016)).toBe(1);
  });

  it("is 1 when a width is missing, so nothing is divided by zero or NaN", () => {
    expect(renderedScale(0, 380)).toBe(1);
    expect(renderedScale(380, 0)).toBe(1);
    expect(renderedScale(380, Number.NaN)).toBe(1);
  });
});
