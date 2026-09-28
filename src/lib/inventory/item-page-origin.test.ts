import { describe, expect, it } from "vitest";
import {
  catalogHref,
  itemPageBackHref,
  itemPageHref,
  parseItemPageOrigin,
  serializeItemPageOrigin,
  type ItemPageOrigin,
} from "./item-page-origin";

describe("item page origin", () => {
  it("round-trips every origin through ?from=", () => {
    const origins: ItemPageOrigin[] = [
      { kind: "inventory" },
      { kind: "catalog", filter: "all" },
      { kind: "catalog", filter: "unitProblems" },
      { kind: "catalog", filter: "neverStocked" },
      { kind: "catalog", filter: "duplicates" },
      { kind: "recipes" },
    ];
    for (const origin of origins) {
      expect(parseItemPageOrigin(serializeItemPageOrigin(origin) ?? undefined)).toEqual(origin);
    }
  });

  it("falls back to the inventory for missing or unknown values", () => {
    expect(parseItemPageOrigin(undefined)).toEqual({ kind: "inventory" });
    expect(parseItemPageOrigin("https://evil.example")).toEqual({ kind: "inventory" });
    expect(parseItemPageOrigin("//evil.example")).toEqual({ kind: "inventory" });
    expect(parseItemPageOrigin(["recipes", "catalog"])).toEqual({ kind: "recipes" });
  });

  it("keeps the catalog but drops an unknown filter", () => {
    expect(parseItemPageOrigin("catalog:bogus")).toEqual({ kind: "catalog", filter: "all" });
  });

  it("builds the item page's URL with its origin", () => {
    expect(itemPageHref("abc")).toBe("/dashboard/inventory/items/abc");
    expect(itemPageHref("abc", { kind: "catalog", filter: "unitProblems" })).toBe(
      "/dashboard/inventory/items/abc?from=catalog%3AunitProblems",
    );
    expect(itemPageHref("abc", { kind: "recipes" })).toBe("/dashboard/inventory/items/abc?from=recipes");
  });

  it("sends the back arrow one step back", () => {
    expect(itemPageBackHref({ kind: "inventory" })).toBe("/dashboard/inventory");
    expect(itemPageBackHref({ kind: "catalog", filter: "unitProblems" })).toBe(
      "/dashboard/inventory/items?filter=unitProblems",
    );
    expect(itemPageBackHref({ kind: "catalog", filter: "all" })).toBe("/dashboard/inventory/items");
    expect(itemPageBackHref({ kind: "recipes" })).toBe("/dashboard/meal-planning?tab=recipes");
    expect(catalogHref("duplicates")).toBe("/dashboard/inventory/items?filter=duplicates");
  });
});
