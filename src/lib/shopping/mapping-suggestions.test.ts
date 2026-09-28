// Tests mappingSuggestions (src/lib/shopping/mapping-suggestions.ts),
// ResolveMappingsDialog's per-row suggestion. Pure — no mocks needed.
import { describe, expect, it } from "vitest";
import { mappingSuggestions } from "@/lib/shopping/mapping-suggestions";

const egg = { id: "egg", name: "Egg" };
const eggNoodles = { id: "noodles", name: "Egg noodles" };
const milk = { id: "milk", name: "Milk" };
const items = [egg, eggNoodles, milk];

describe("mappingSuggestions", () => {
  it("pre-selects the best fuzzy match without an alias", () => {
    const { suggestions, preselectedId } = mappingSuggestions("Eggs", items);
    expect(preselectedId).toBe("egg");
    expect(suggestions[0]).toBe(egg);
  });

  it("pre-selects nothing when no match is close enough", () => {
    expect(mappingSuggestions("Batteries", items).preselectedId).toBeNull();
  });

  it("pre-selects the household's alias and lists it first (MATCH-5)", () => {
    const { suggestions, preselectedId } = mappingSuggestions("Äggnudlar", items, [
      { normalizedName: "äggnudlar", inventoryItemId: "noodles" },
    ]);
    expect(preselectedId).toBe("noodles");
    expect(suggestions[0]).toBe(eggNoodles);
    expect(suggestions.filter((item) => item === eggNoodles)).toHaveLength(1);
  });

  it("puts the alias ahead of a better fuzzy score", () => {
    const { suggestions, preselectedId } = mappingSuggestions("Eggs", items, [
      { normalizedName: "eggs", inventoryItemId: "noodles" },
    ]);
    expect(preselectedId).toBe("noodles");
    expect(suggestions.map((item) => item.id)).toEqual(["noodles", "egg"]);
  });

  it("ignores an untracked alias and one whose item is gone", () => {
    const aliases = [
      { normalizedName: "eggs", inventoryItemId: null },
      { normalizedName: "mjölk", inventoryItemId: "deleted" },
    ];
    expect(mappingSuggestions("Eggs", items, aliases).preselectedId).toBe("egg");
    expect(mappingSuggestions("Mjölk", items, aliases).preselectedId).toBeNull();
  });
});
