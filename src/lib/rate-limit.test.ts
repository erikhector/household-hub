import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetRateLimitsForTests, checkRateLimit } from "@/lib/rate-limit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  _resetRateLimitsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("allows attempts up to the limit and then blocks", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("key", 3, 1000)).toBe(true);
    }
    expect(checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("keeps blocking on repeated calls within the window, not just the first over-limit call", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("key", 3, 1000);
    expect(checkRateLimit("key", 3, 1000)).toBe(false);
    expect(checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("tracks distinct keys independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("a", 3, 1000);
    expect(checkRateLimit("a", 3, 1000)).toBe(false);
    expect(checkRateLimit("b", 3, 1000)).toBe(true);
  });

  it("resets once the window elapses", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("key", 3, 1000);
    expect(checkRateLimit("key", 3, 1000)).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(checkRateLimit("key", 3, 1000)).toBe(true);
  });

  it("does not let a caller dodge the limit by varying the key's case if the caller normalizes first", () => {
    // checkRateLimit itself is case-sensitive — this documents that callers
    // (loginAction/signupAction) must normalize the email themselves before
    // building the key, which they do via zod's .toLowerCase().
    checkRateLimit("user@example.com", 1, 1000);
    expect(checkRateLimit("USER@EXAMPLE.COM", 1, 1000)).toBe(true);
    expect(checkRateLimit("user@example.com", 1, 1000)).toBe(false);
  });
});
