import { describe, expect, it } from "vitest";
import { formatShoppingListText, type ShoppingListTextGroup } from "@/lib/shopping-list-text";

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
