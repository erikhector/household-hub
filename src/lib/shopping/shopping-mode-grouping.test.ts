import { describe, expect, it } from "vitest";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";

type Item = { id: string; category: string | null };
const item = (id: string, category: string | null): Item => ({ id, category });

describe("groupPendingItemsByCategory", () => {
  it("groups known categories in the fixed produce → … → household order, regardless of input order", () => {
    const groups = groupPendingItemsByCategory(
      [
        item("1", "Frozen"),
        item("2", "Dairy & eggs"),
        item("3", "Produce"),
        item("4", "Bathroom essentials"),
      ],
      "Other",
    );
    expect(groups.map((g) => g.label)).toEqual(["Produce", "Dairy & eggs", "Frozen", "Bathroom essentials"]);
  });

  it("matches a category stored in either locale to the same slot", () => {
    // A household with mixed-locale history: some items filed in English,
    // some in Swedish, both meaning the same canonical category.
    const groups = groupPendingItemsByCategory(
      [item("1", "Mejeri & ägg"), item("2", "Dairy & eggs")],
      "Other",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("keeps items' relative order within a group", () => {
    const groups = groupPendingItemsByCategory(
      [item("a", "Produce"), item("b", "Dairy & eggs"), item("c", "Produce")],
      "Other",
    );
    const produce = groups.find((g) => g.label === "Produce");
    expect(produce?.items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("puts a household's own custom category after the known ones, alphabetically", () => {
    const groups = groupPendingItemsByCategory(
      [item("1", "Zephyr shelf"), item("2", "Produce"), item("3", "Basement stash")],
      "Other",
    );
    expect(groups.map((g) => g.label)).toEqual(["Produce", "Basement stash", "Zephyr shelf"]);
  });

  it("puts items with no category, blank category, or the Uncategorized placeholder under Other, last", () => {
    const groups = groupPendingItemsByCategory(
      [
        item("1", "Uncategorized"),
        item("2", "Produce"),
        item("3", null),
        item("4", "Okategoriserat"),
        item("5", "   "),
      ],
      "Other",
    );
    expect(groups.map((g) => g.label)).toEqual(["Produce", "Other"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["1", "3", "4", "5"]);
  });

  it("doesn't produce a group for a category with no items", () => {
    const groups = groupPendingItemsByCategory([item("1", "Produce")], "Other");
    expect(groups).toHaveLength(1);
  });

  it("returns no groups for an empty list", () => {
    expect(groupPendingItemsByCategory([], "Other")).toEqual([]);
  });
});
