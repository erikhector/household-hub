import { describe, expect, it } from "vitest";
import { timingSafeStringEqual } from "@/lib/timing-safe-equal";

// SEC-9: this is the constant-time comparison every secret/token check in
// the app (the cron routes' bearer token, the digest unsubscribe token's
// HMAC) now goes through instead of `===`/`!==`. The behavioral contract is
// simple — true iff the strings are identical — but it's worth pinning
// down the edge cases crypto.timingSafeEqual doesn't handle on its own
// (different lengths, empty strings) since those are exactly where a naive
// wrapper would throw or misbehave instead of returning false.
describe("timingSafeStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeStringEqual("Bearer test-secret", "Bearer test-secret")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeStringEqual("Bearer aaaaaaaa", "Bearer bbbbbbbb")).toBe(false);
  });

  it("returns false for strings of different lengths, without throwing", () => {
    // crypto.timingSafeEqual throws on mismatched buffer lengths — the
    // whole point of this helper is that callers never have to special-case
    // that themselves.
    expect(timingSafeStringEqual("short", "a-lot-longer-value")).toBe(false);
    expect(timingSafeStringEqual("a-lot-longer-value", "short")).toBe(false);
  });

  it("treats empty strings as equal to each other and unequal to anything else", () => {
    expect(timingSafeStringEqual("", "")).toBe(true);
    expect(timingSafeStringEqual("", "x")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(timingSafeStringEqual("Secret", "secret")).toBe(false);
  });
});
