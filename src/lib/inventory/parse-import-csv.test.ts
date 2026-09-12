import { describe, expect, it } from "vitest";
import { parseImportCsv } from "@/lib/inventory/parse-import-csv";

describe("parseImportCsv", () => {
  it("parses a well-formed file with a header and several rows", () => {
    const csv = "Name,Quantity,Unit\r\nMilk,2,l\r\nEggs,12,pcs\r\nFlour,,\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [
        { name: "Milk", quantity: 2, unit: "l" },
        { name: "Eggs", quantity: 12, unit: "pcs" },
        { name: "Flour", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("matches this app's own export headers, including columns it ignores", () => {
    const csv =
      "Name,Category,Quantity,Unit,Location,Low-stock threshold,Last known price\r\n" +
      "Milk,Dairy,2,l,Fridge,1,15.5\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [{ name: "Milk", quantity: 2, unit: "l" }],
    });
  });

  it("matches header names case-insensitively and with common aliases", () => {
    const csv = "ITEM NAME,QTY,Units\r\nBananas,6,pcs\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [{ name: "Bananas", quantity: 6, unit: "pcs" }],
    });
  });

  it("handles quoted fields containing commas", () => {
    const csv = 'Name,Quantity,Unit\r\n"Rice, jasmine",1,bag\r\n';
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [{ name: "Rice, jasmine", quantity: 1, unit: "bag" }],
    });
  });

  it("defaults quantity to 1 and unit to pcs when those columns are absent", () => {
    const csv = "Name\r\nMilk\r\nEggs\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [
        { name: "Milk", quantity: 1, unit: "pcs" },
        { name: "Eggs", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("skips rows with a blank name", () => {
    const csv = "Name,Quantity\r\nMilk,2\r\n,5\r\nEggs,12\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [
        { name: "Milk", quantity: 2, unit: "pcs" },
        { name: "Eggs", quantity: 12, unit: "pcs" },
      ],
    });
  });

  it("falls back to quantity 1 for an unparseable or non-positive quantity", () => {
    const csv = "Name,Quantity\r\nMilk,abc\r\nEggs,-3\r\nFlour,0\r\n";
    expect(parseImportCsv(csv)).toEqual({
      ok: true,
      items: [
        { name: "Milk", quantity: 1, unit: "pcs" },
        { name: "Eggs", quantity: 1, unit: "pcs" },
        { name: "Flour", quantity: 1, unit: "pcs" },
      ],
    });
  });

  it("returns a missingNameColumn error when there is no name column", () => {
    const csv = "Category,Quantity\r\nDairy,2\r\n";
    expect(parseImportCsv(csv)).toEqual({ ok: false, error: "missingNameColumn" });
  });

  it("returns an emptyFile error for an empty file", () => {
    expect(parseImportCsv("")).toEqual({ ok: false, error: "emptyFile" });
  });

  it("returns an emptyFile error for a header-only file with no data rows", () => {
    expect(parseImportCsv("Name,Quantity\r\n")).toEqual({ ok: false, error: "emptyFile" });
  });

  it("returns an emptyFile error for whitespace-only input", () => {
    expect(parseImportCsv("   \n  \n")).toEqual({ ok: false, error: "emptyFile" });
  });
});
