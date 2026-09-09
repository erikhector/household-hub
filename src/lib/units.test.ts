import { describe, expect, it } from "vitest";
import { convertQuantity, unitsAreComparable } from "./units";

describe("convertQuantity", () => {
  it("converts between volume units", () => {
    expect(convertQuantity(1, "l", "tbsp")).toBeCloseTo(66.67, 1);
    expect(convertQuantity(3, "tbsp", "l")).toBeCloseTo(0.045, 3);
    expect(convertQuantity(1, "cup", "ml")).toBeCloseTo(240, 5);
  });

  it("converts between weight units", () => {
    expect(convertQuantity(1, "kg", "g")).toBe(1000);
    expect(convertQuantity(500, "g", "kg")).toBe(0.5);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(convertQuantity(1, " Liters ", "ML")).toBeCloseTo(1000, 5);
  });

  it("returns null across dimensions (volume vs weight)", () => {
    expect(convertQuantity(1, "cup", "g")).toBeNull();
  });

  it("returns null for unrecognized units", () => {
    expect(convertQuantity(1, "cup", "smidgen")).toBeNull();
    expect(convertQuantity(1, "pcs", "clove")).toBeNull();
  });
});

describe("unitsAreComparable", () => {
  it("is true for the exact same unit, regardless of case/whitespace", () => {
    expect(unitsAreComparable("Pcs", " pcs ")).toBe(true);
  });

  it("is true for different but convertible units", () => {
    expect(unitsAreComparable("l", "tbsp")).toBe(true);
  });

  it("is false across dimensions or for unrecognized units", () => {
    expect(unitsAreComparable("cup", "g")).toBe(false);
    expect(unitsAreComparable("clove", "pcs")).toBe(false);
  });
});
