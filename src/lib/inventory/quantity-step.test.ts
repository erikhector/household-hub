import { describe, expect, it } from "vitest";
import { parseAmount, quantityPresets, quantityStep } from "./quantity-step";

describe("quantityStep", () => {
  it("steps weights and volumes by a pantry-sized amount", () => {
    expect(quantityStep("g")).toBe(50);
    expect(quantityStep("grams")).toBe(50);
    expect(quantityStep("ml")).toBe(50);
    expect(quantityStep("kg")).toBe(0.25);
    expect(quantityStep("Litres")).toBe(0.25);
  });

  it("keeps 1 for counts and unknown units", () => {
    expect(quantityStep("pcs")).toBe(1);
    expect(quantityStep("st")).toBe(1);
    expect(quantityStep("jar of something")).toBe(1);
  });
});

describe("quantityPresets", () => {
  it("offers unit-sized chips", () => {
    expect(quantityPresets("g")).toEqual([100, 200, 500]);
    expect(quantityPresets("kg")).toEqual([0.25, 0.5, 1]);
    expect(quantityPresets("pcs")).toEqual([1, 2, 5]);
  });
});

describe("parseAmount", () => {
  it("parses dot and comma decimals", () => {
    expect(parseAmount("200")).toBe(200);
    expect(parseAmount("0,5")).toBe(0.5);
    expect(parseAmount(" 1.25 ")).toBe(1.25);
  });

  it("rejects empty, zero, negative, non-numeric and absurd input", () => {
    for (const raw of ["", "  ", "0", "-3", "abc", "0.001", "2000000"]) {
      expect(parseAmount(raw)).toBeNull();
    }
  });
});
