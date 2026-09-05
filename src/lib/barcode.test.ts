import { describe, expect, it } from "vitest";
import { isValidBarcodeFormat } from "@/lib/barcode";

describe("isValidBarcodeFormat", () => {
  it("accepts EAN-13", () => {
    expect(isValidBarcodeFormat("7311041052452")).toBe(true);
  });

  it("accepts UPC-A", () => {
    expect(isValidBarcodeFormat("036000291452")).toBe(true);
  });

  it("accepts EAN-8", () => {
    expect(isValidBarcodeFormat("96385074")).toBe(true);
  });

  it("accepts UPC-E (6 digits)", () => {
    expect(isValidBarcodeFormat("425261")).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidBarcodeFormat("  7311041052452  ")).toBe(true);
  });

  it("rejects a string shorter than 6 digits", () => {
    expect(isValidBarcodeFormat("12345")).toBe(false);
  });

  it("rejects a string longer than 14 digits", () => {
    expect(isValidBarcodeFormat("123456789012345")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidBarcodeFormat("73110A1052452")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidBarcodeFormat("")).toBe(false);
  });

  it("rejects arbitrary text", () => {
    expect(isValidBarcodeFormat("not-a-barcode")).toBe(false);
  });
});
