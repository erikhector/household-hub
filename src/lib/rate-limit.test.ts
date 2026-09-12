import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("checkRateLimit (in-memory backend, no Upstash env vars set)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function loadRateLimit() {
    const mod = await import("@/lib/rate-limit");
    mod._resetRateLimitsForTests();
    return mod;
  }

  it("allows attempts up to the limit and then blocks", async () => {
    const { checkRateLimit } = await loadRateLimit();
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("key", 3, 1000)).toBe(true);
    }
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("keeps blocking on repeated calls within the window, not just the first over-limit call", async () => {
    const { checkRateLimit } = await loadRateLimit();
    for (let i = 0; i < 3; i++) await checkRateLimit("key", 3, 1000);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("tracks distinct keys independently", async () => {
    const { checkRateLimit } = await loadRateLimit();
    for (let i = 0; i < 3; i++) await checkRateLimit("a", 3, 1000);
    expect(await checkRateLimit("a", 3, 1000)).toBe(false);
    expect(await checkRateLimit("b", 3, 1000)).toBe(true);
  });

  it("resets once the window elapses", async () => {
    const { checkRateLimit } = await loadRateLimit();
    for (let i = 0; i < 3; i++) await checkRateLimit("key", 3, 1000);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(await checkRateLimit("key", 3, 1000)).toBe(true);
  });

  it("does not let a caller dodge the limit by varying the key's case if the caller normalizes first", async () => {
    // checkRateLimit itself is case-sensitive — this documents that callers
    // (loginAction/signupAction) must normalize the email themselves before
    // building the key, which they do via zod's .toLowerCase().
    const { checkRateLimit } = await loadRateLimit();
    await checkRateLimit("user@example.com", 1, 1000);
    expect(await checkRateLimit("USER@EXAMPLE.COM", 1, 1000)).toBe(true);
    expect(await checkRateLimit("user@example.com", 1, 1000)).toBe(false);
  });

  it("does not warn when Upstash env vars are unset outside production (dev/test noise guard)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkRateLimit } = await loadRateLimit();
    await checkRateLimit("key", 3, 1000);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns once in production when falling back to the in-memory limiter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkRateLimit } = await loadRateLimit();
    await checkRateLimit("key", 3, 1000);
    await checkRateLimit("key2", 3, 1000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("UPSTASH_REDIS_REST_URL");
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("checkRateLimit (Upstash Redis backend)", () => {
  // Mirrors just enough of @upstash/redis's SET NX PX / INCR behavior for
  // the limiter's logic to exercise against, without hitting a real Upstash
  // instance. Keyed store shared across the mocked client's methods.
  const store = new Map<string, { value: number; expiresAt: number }>();

  beforeEach(() => {
    vi.resetModules();
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

    vi.doMock("@upstash/redis", () => {
      return {
        Redis: vi.fn().mockImplementation(function () {
          return {
            set: vi.fn(async (key: string, value: number, opts?: { nx?: boolean; px?: number }) => {
              const now = Date.now();
              const existing = store.get(key);
              if (opts?.nx && existing && existing.expiresAt > now) {
                return null; // NX: key already exists and hasn't expired
              }
              store.set(key, { value, expiresAt: now + (opts?.px ?? 0) });
              return "OK";
            }),
            incr: vi.fn(async (key: string) => {
              const now = Date.now();
              const existing = store.get(key);
              // Real Redis leaves TTL untouched on INCR; mirror that by
              // keeping the existing expiresAt rather than resetting it.
              const next = (existing && existing.expiresAt > now ? existing.value : 0) + 1;
              store.set(key, { value: next, expiresAt: existing?.expiresAt ?? now });
              return next;
            }),
          };
        }),
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.doUnmock("@upstash/redis");
  });

  it("allows attempts up to the limit and then blocks", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit("key", 3, 1000)).toBe(true);
    }
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("keeps blocking on repeated calls within the window, not just the first over-limit call", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 3; i++) await checkRateLimit("key", 3, 1000);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);
  });

  it("tracks distinct keys independently", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 3; i++) await checkRateLimit("a", 3, 1000);
    expect(await checkRateLimit("a", 3, 1000)).toBe(false);
    expect(await checkRateLimit("b", 3, 1000)).toBe(true);
  });

  it("resets once the window elapses", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 3; i++) await checkRateLimit("key", 3, 1000);
    expect(await checkRateLimit("key", 3, 1000)).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(await checkRateLimit("key", 3, 1000)).toBe(true);
  });

  it("does not warn about the in-memory fallback when Redis is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkRateLimit } = await import("@/lib/rate-limit");
    await checkRateLimit("key", 3, 1000);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to the in-memory limiter (without throwing) when the Redis client errors", async () => {
    vi.doMock("@upstash/redis", () => ({
      Redis: vi.fn().mockImplementation(function () {
        return {
          set: vi.fn(async () => {
            throw new Error("simulated Upstash network error");
          }),
          incr: vi.fn(async () => {
            throw new Error("simulated Upstash network error");
          }),
        };
      }),
    }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { checkRateLimit } = await import("@/lib/rate-limit");

    await expect(checkRateLimit("key", 1, 1000)).resolves.toBe(true);
    // Second attempt within the window should still be governed by a limit
    // (the in-memory fallback), not silently allow everything through.
    expect(await checkRateLimit("key", 1, 1000)).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
