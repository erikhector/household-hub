import { describe, expect, it } from "vitest";
import { parsePastedList } from "@/lib/inventory/parse-pasted-list";

describe("parsePastedList", () => {
  it("doesn't split on commas inside brackets (UX-88)", () => {
    expect(parsePastedList("dishwasher tablets (lemon-free, 120 st), paper towels")).toEqual([
      { name: "dishwasher tablets (lemon-free, 120 st)", quantity: 1, unit: "pcs" },
      { name: "paper towels", quantity: 1, unit: "pcs" },
    ]);
    expect(parsePastedList("2 l milk [oat, barista], bread")).toEqual([
      { name: "milk [oat, barista]", quantity: 2, unit: "l" },
      { name: "bread", quantity: 1, unit: "pcs" },
    ]);
  });

  it("keeps a decimal comma inside one row (UX-200)", () => {
    expect(parsePastedList("1,5 l mjölk, bröd")).toEqual([
      { name: "mjölk", quantity: 1.5, unit: "l" },
      { name: "bröd", quantity: 1, unit: "pcs" },
    ]);
    expect(parsePastedList("mjölk 1,5 l")).toEqual([{ name: "mjölk", quantity: 1.5, unit: "l" }]);
    expect(parsePastedList("havredryck 1,5 liter")).toEqual([
      { name: "havredryck 1,5 liter", quantity: 1, unit: "pcs" },
    ]);
    // Only a comma with a digit directly on both sides is a decimal: a space
    // on either side still separates items.
    expect(parsePastedList("ägg 6, 2 l mjölk")).toEqual([
      { name: "ägg 6", quantity: 1, unit: "pcs" },
      { name: "mjölk", quantity: 2, unit: "l" },
    ]);
    expect(parsePastedList("bröd,2 l mjölk")).toEqual([
      { name: "bröd", quantity: 1, unit: "pcs" },
      { name: "mjölk", quantity: 2, unit: "l" },
    ]);
  });

  it("treats an unclosed bracket as plain text", () => {
    expect(parsePastedList("milk (oat, bread")).toEqual([
      { name: "milk (oat", quantity: 1, unit: "pcs" },
      { name: "bread", quantity: 1, unit: "pcs" },
    ]);
  });

  it("splits on newlines and commas", () => {
    expect(parsePastedList("Milk, Bread\nEggs")).toEqual([
      { name: "Milk", quantity: 1, unit: "pcs" },
      { name: "Bread", quantity: 1, unit: "pcs" },
      { name: "Eggs", quantity: 1, unit: "pcs" },
    ]);
  });

  it("picks up a leading count with a recognized unit word", () => {
    expect(parsePastedList("2 cans tomatoes")).toEqual([{ name: "tomatoes", quantity: 2, unit: "cans" }]);
  });

  it("picks up a leading count with no unit word as a plain quantity", () => {
    expect(parsePastedList("3 apples")).toEqual([{ name: "apples", quantity: 3, unit: "pcs" }]);
  });

  it("picks up a trailing 'x count'", () => {
    expect(parsePastedList("AA batteries x8")).toEqual([{ name: "AA batteries", quantity: 8, unit: "pcs" }]);
  });

  it("picks up a trailing 'count unit' (the Swedish grocery-app export style)", () => {
    expect(parsePastedList("Mjölk 1 l\nÄgg 12 st\nSmör 500 g")).toEqual([
      { name: "Mjölk", quantity: 1, unit: "l" },
      { name: "Ägg", quantity: 12, unit: "st" },
      { name: "Smör", quantity: 500, unit: "g" },
    ]);
  });

  it("doesn't mistake a trailing unrecognized word for a unit", () => {
    expect(parsePastedList("Milk 2percent")).toEqual([{ name: "Milk 2percent", quantity: 1, unit: "pcs" }]);
  });

  it("strips leading bullet and checkbox markers before parsing", () => {
    expect(parsePastedList("- Milk\n• Eggs 12 st\n[ ] Bread\n[x] Butter\n☐ Cheese\n✓ Yogurt")).toEqual([
      { name: "Milk", quantity: 1, unit: "pcs" },
      { name: "Eggs", quantity: 12, unit: "st" },
      { name: "Bread", quantity: 1, unit: "pcs" },
      { name: "Butter", quantity: 1, unit: "pcs" },
      { name: "Cheese", quantity: 1, unit: "pcs" },
      { name: "Yogurt", quantity: 1, unit: "pcs" },
    ]);
  });

  it("ignores blank lines and blank comma segments", () => {
    expect(parsePastedList("Milk\n\n, ,\nEggs")).toEqual([
      { name: "Milk", quantity: 1, unit: "pcs" },
      { name: "Eggs", quantity: 1, unit: "pcs" },
    ]);
  });
});
