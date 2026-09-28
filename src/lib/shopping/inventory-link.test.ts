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

  describe("learned aliases (MATCH-5)", () => {
    const egg = { id: "egg", name: "Egg" };
    const benedictMix = { id: "mix", name: "Eggs benedict mix" };

    it("links a name through the household's alias", () => {
      const link = createInventoryLinker([milk, egg], [{ normalizedName: "eggs", inventoryItemId: egg.id }]);
      expect(link("Eggs")).toBe(egg);
    });

    it("prefers an exact name over an alias", () => {
      const eggs = { id: "eggs", name: "Eggs" };
      const link = createInventoryLinker([egg, eggs], [{ normalizedName: "eggs", inventoryItemId: egg.id }]);
      expect(link("eggs")).toBe(eggs);
    });

    it("prefers the alias over a fuzzy match", () => {
      // Without the alias, "Eggs bene" fuzzily matches the mix.
      expect(createInventoryLinker([egg, benedictMix])("Eggs bene")?.id).toBe(benedictMix.id);
      const link = createInventoryLinker([egg, benedictMix], [{ normalizedName: "eggs bene", inventoryItemId: egg.id }]);
      expect(link("Eggs bene")).toBe(egg);
    });

    it("doesn't link through an untracked alias, and still tries fuzzy", () => {
      const water = { id: "water", name: "Watter" };
      expect(createInventoryLinker([milk], [{ normalizedName: "water", inventoryItemId: null }])("water")).toBeNull();
      const link = createInventoryLinker([water], [{ normalizedName: "water", inventoryItemId: null }]);
      expect(link("water")?.id).toBe(water.id);
    });

    it("ignores an alias whose item isn't in the inventory", () => {
      const link = createInventoryLinker([milk], [{ normalizedName: "eggs", inventoryItemId: "gone" }]);
      expect(link("eggs")).toBeNull();
    });
  });
});
