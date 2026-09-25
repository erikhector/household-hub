import { describe, expect, it } from "vitest";
import { acceptScan, isValidBarcodeFormat, normalizeBarcode, SAME_CODE_REPEAT_MS, type RepeatGuardState } from "@/lib/barcode";

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

describe("normalizeBarcode", () => {
  it("pads a 12-digit UPC-A to its GTIN-13 form so both decodes share a key", () => {
    expect(normalizeBarcode("036000291452")).toBe("0036000291452");
    expect(normalizeBarcode("0036000291452")).toBe("0036000291452");
  });

  it("keeps EAN-13, EAN-8 and UPC-E as scanned, trimmed", () => {
    expect(normalizeBarcode(" 7311041052452 ")).toBe("7311041052452");
    expect(normalizeBarcode("96385074")).toBe("96385074");
    expect(normalizeBarcode("425261")).toBe("425261");
  });

  it("returns null for anything that isn't barcode-shaped", () => {
    expect(normalizeBarcode("abc")).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
  });
});

describe("acceptScan", () => {
  const empty: RepeatGuardState = { code: null, lastSeenAt: 0 };

  it("accepts the first sighting of a code", () => {
    expect(acceptScan(empty, "7311041052452", 1000).accept).toBe(true);
  });

  it("ignores the same code while it stays in frame, refreshing lastSeenAt each time", () => {
    let state = acceptScan(empty, "7311041052452", 1000).next;
    const again = acceptScan(state, "7311041052452", 1000 + SAME_CODE_REPEAT_MS - 1);
    expect(again.accept).toBe(false);
    state = again.next;
    // Still suppressed: measured from the last sighting, not the first.
    expect(acceptScan(state, "7311041052452", 1000 + SAME_CODE_REPEAT_MS + 500).accept).toBe(false);
  });

  it("accepts the same code again once it's been gone for the whole window", () => {
    const state = acceptScan(empty, "7311041052452", 1000).next;
    expect(acceptScan(state, "7311041052452", 1000 + SAME_CODE_REPEAT_MS).accept).toBe(true);
  });

  it("accepts a different code straight away", () => {
    const state = acceptScan(empty, "7311041052452", 1000).next;
    expect(acceptScan(state, "96385074", 1001).accept).toBe(true);
  });
});
