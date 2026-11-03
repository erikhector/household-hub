import { describe, expect, it } from "vitest";
import { normalizeSourceUrl, sourceHost } from "@/lib/recipe-source";

describe("normalizeSourceUrl", () => {
  it("accepts http and https and trims", () => {
    expect(normalizeSourceUrl(" https://www.bbc.co.uk/food/x ")).toBe("https://www.bbc.co.uk/food/x");
    expect(normalizeSourceUrl("http://example.com")).toBe("http://example.com/");
  });
  it("rejects other schemes, junk, non-strings and over-long addresses", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.b/c", "nope", "", 5, null]) {
      expect(normalizeSourceUrl(bad)).toBeNull();
    }
    expect(normalizeSourceUrl(`https://example.com/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("sourceHost", () => {
  it("shows the host without www", () => {
    expect(sourceHost("https://www.bbc.co.uk/food/x")).toBe("bbc.co.uk");
    expect(sourceHost("javascript:alert(1)")).toBeNull();
  });
});
