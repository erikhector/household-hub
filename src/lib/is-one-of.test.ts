import { describe, expect, it } from "vitest";
import { isOneOf } from "@/lib/is-one-of";

describe("isOneOf", () => {
  const isMode = isOneOf(["a", "b"]);

  it("accepts listed values", () => {
    expect(isMode("a")).toBe(true);
    expect(isMode("b")).toBe(true);
  });

  it("rejects unlisted, non-string and nullish values", () => {
    expect(isMode("c")).toBe(false);
    expect(isMode(null)).toBe(false);
    expect(isMode(undefined)).toBe(false);
    expect(isMode(1)).toBe(false);
  });
});
