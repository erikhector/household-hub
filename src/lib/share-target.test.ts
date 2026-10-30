import { describe, expect, it } from "vitest";
import { resolveShareTarget } from "./share-target";

describe("resolveShareTarget", () => {
  it("sends a shared link to the recipe import", () => {
    expect(resolveShareTarget({ url: "https://example.com/pasta?x=1&y=2" })).toBe(
      "/dashboard/meal-planning?tab=recipes&importUrl=" + encodeURIComponent("https://example.com/pasta?x=1&y=2"),
    );
  });

  it("treats a text that is just one link as a link (Android puts it there)", () => {
    expect(resolveShareTarget({ text: "https://example.com/pasta" })).toBe(
      "/dashboard/meal-planning?tab=recipes&importUrl=" + encodeURIComponent("https://example.com/pasta"),
    );
  });

  it("sends plain text to the shopping list's paste dialog", () => {
    expect(resolveShareTarget({ text: "Milk 1 l\nEggs x12" })).toBe(
      "/dashboard/shopping-list?pasteText=" + encodeURIComponent("Milk 1 l\nEggs x12"),
    );
  });

  it("prefers the url over the text", () => {
    expect(resolveShareTarget({ url: "https://example.com/a", text: "Milk" })).toContain("/meal-planning");
  });

  it("ignores a non-http url and falls back to the text", () => {
    expect(resolveShareTarget({ url: "javascript:alert(1)", text: "Milk" })).toBe(
      "/dashboard/shopping-list?pasteText=Milk",
    );
  });

  it("returns null when there is nothing usable", () => {
    expect(resolveShareTarget({})).toBeNull();
    expect(resolveShareTarget({ text: "   ", url: "" })).toBeNull();
    expect(resolveShareTarget({ url: "javascript:alert(1)" })).toBeNull();
  });

  it("never builds a path from the input (no open redirect)", () => {
    for (const evil of ["//evil.com", "https://evil.com/x", "/\\evil.com", "//evil.com\nMilk"]) {
      const target = resolveShareTarget({ text: evil, url: evil });
      expect(target).toMatch(/^\/dashboard\/(meal-planning|shopping-list)\?/);
    }
  });

  it("caps an oversized share", () => {
    const target = resolveShareTarget({ text: "a".repeat(100_000) })!;
    expect(target.length).toBeLessThan(5000);
  });
});
