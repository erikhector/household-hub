// Tests createInventoryLinker (src/lib/shopping/inventory-link.ts), the
// name → InventoryItem resolver shared by importShoppingListItemsAction and
// GAP-4's createListFromTemplateAction. Pure — no mocks needed.
import { describe, expect, it } from "vitest";
import { createInventoryLinker } from "@/lib/shopping/inventory-link";

const milk = { id: "milk", name: "Milk" };
const oatMilk = { id: "oat", name: "Oat milk" };
const bread = { id: "bread", name: "Sourdough bread" };

describe("createInventoryLinker", () => {
  it("links an exact name case- and whitespace-insensitively", () => {
    const link = createInventoryLinker([milk, oatMilk, bread]);
    expect(link("  MILK ")).toBe(milk);
  });

  it("falls back to a single confident fuzzy match", () => {
    const link = createInventoryLinker([milk, bread]);
    expect(link("Sourdough bred")?.id).toBe(bread.id);
  });

  it("leaves a row unlinked when nothing is close enough", () => {
    const link = createInventoryLinker([milk, bread]);
    expect(link("Batteries")).toBeNull();
  });

  it("leaves a row unlinked when two candidates both match", () => {
    const link = createInventoryLinker([
      { id: "a", name: "Tomatoes canned" },
      { id: "b", name: "Tomatoes cherry" },
    ]);
    expect(link("Tomatoes")).toBeNull();
  });

  it("returns null over an empty inventory", () => {
    expect(createInventoryLinker([])("Milk")).toBeNull();
  });
});
