import { describe, expect, it } from "vitest";
import { formatShoppingItemLabel, formatShoppingListText, isDefaultAmount, type ShoppingListTextGroup } from "@/lib/shopping-list-text";

const dairy: ShoppingListTextGroup = {
  key: "auto:dairy",
  label: "Dairy & eggs",
  items: [
    { name: "Milk", quantity: 2, unit: "dl" },
    { name: "Eggs", quantity: 0.5, unit: "" },
  ],
};
const other: ShoppingListTextGroup = {
  key: null,
  label: "Other",
  items: [{ name: "Salt", quantity: 0, unit: "g" }],
};

describe("formatShoppingListText", () => {
  it("puts each item on a '- amount name' line under its category heading", () => {
    expect(formatShoppingListText("Weekend shop", [dairy, other], "en")).toBe(
      ["Weekend shop", "", "Dairy & eggs", "- 2 dl Milk", "- 0.5 Eggs", "", "Other", "- Salt"].join("\n"),
    );
  });

  it("is flat when no item has a category", () => {
    expect(formatShoppingListText("Weekend shop", [other], "en")).toBe("Weekend shop\n- Salt");
  });

  it("uses the locale's decimal mark and the unit label mapper", () => {
    const text = formatShoppingListText(
      "Veckohandling",
      [{ key: "auto:dairy", label: "Mejeri & ägg", items: [{ name: "Mjölk", quantity: 1.5, unit: "l" }] }],
      "sv",
      (unit) => (unit === "l" ? "liter" : unit),
    );
    expect(text).toBe("Veckohandling\n\nMejeri & ägg\n- 1,5 liter Mjölk");
  });

  it("leaves checked items out, and a heading whose items are all checked", () => {
    const text = formatShoppingListText(
      "Weekend shop",
      [
        {
          ...dairy,
          items: [
            { name: "Milk", quantity: 2, unit: "dl" },
            { name: "Eggs", quantity: 6, unit: "", purchased: true },
          ],
        },
        { ...other, items: [{ name: "Salt", quantity: 0, unit: "g", purchased: true }] },
      ],
      "en",
    );
    expect(text).toBe("Weekend shop\n\nDairy & eggs\n- 2 dl Milk");
  });

  it("prints just the name when nothing is open", () => {
    expect(formatShoppingListText("Empty", [], "en")).toBe("Empty");
  });
});

describe("default amount (UX-86)", () => {
  it("treats only 1 pcs as the default", () => {
    expect(isDefaultAmount(1, "pcs")).toBe(true);
    expect(isDefaultAmount(2, "pcs")).toBe(false);
    expect(isDefaultAmount(1, "l")).toBe(false);
  });

  it("labels 1 pcs as just the name and anything else with its amount", () => {
    const label = (name: string, quantity: number, unit: string) => formatShoppingItemLabel({ name, quantity, unit }, (u) => u);
    expect(label("Bananas", 1, "pcs")).toBe("Bananas");
    expect(label("Milk", 2, "l")).toBe("Milk × 2 l");
    expect(label("Eggs", 2, "pcs")).toBe("Eggs × 2 pcs");
  });

  it("copies 1 pcs as just the name", () => {
    const group: ShoppingListTextGroup = {
      key: null,
      label: "Other",
      items: [
        { name: "Dill", quantity: 1, unit: "pcs" },
        { name: "Milk", quantity: 2, unit: "l" },
      ],
    };
    expect(formatShoppingListText("L", [group], "en")).toBe("L\n- Dill\n- 2 l Milk");
  });
});
