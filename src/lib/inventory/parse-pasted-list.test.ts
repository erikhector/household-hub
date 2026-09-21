import { describe, expect, it } from "vitest";
import { parsePastedList } from "@/lib/inventory/parse-pasted-list";

describe("parsePastedList", () => {
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
