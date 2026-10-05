import { describe, expect, it } from "vitest";
import { cookScale, formatCookQuantity, splitSteps } from "@/lib/cook-mode-calc";

describe("splitSteps", () => {
  it("splits on lines, trims and drops blanks", () => {
    expect(splitSteps("Mix\r\n\n  Bake  \n")).toEqual(["Mix", "Bake"]);
  });
  it("returns no steps for empty or missing instructions", () => {
    expect(splitSteps(null)).toEqual([]);
    expect(splitSteps("  \n ")).toEqual([]);
  });
});

describe("cookScale", () => {
  it("scales to the entry's portions", () => {
    expect(cookScale(4, 2)).toBe(0.5);
    expect(cookScale(4, 6)).toBe(1.5);
  });
  it("leaves amounts as written without a meal entry", () => {
    expect(cookScale(4, null)).toBe(1);
  });
  it("never produces NaN or Infinity", () => {
    expect(cookScale(0, 2)).toBe(1);
    expect(cookScale(4, 0)).toBe(1);
  });
});

describe("formatCookQuantity", () => {
  it("rounds to two decimals without trailing zeros", () => {
    expect(formatCookQuantity(750, 0.5, "en")).toBe("375");
    expect(formatCookQuantity(1, 1 / 3, "en")).toBe("0.33");
  });
  it("uses the locale's decimal mark", () => {
    expect(formatCookQuantity(1, 0.5, "sv")).toBe("0,5");
  });
});
