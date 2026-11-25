// PERF-32a: the tag helper and the flag that gates every cache call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: m.updateTag }));

import { householdTag, invalidateHome } from "@/lib/household-cache";
import { isHomeCacheEnabled } from "@/lib/home-cache-flag";

const UPSTASH = { UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "token" };

describe("householdTag", () => {
  it("scopes the area to the household", () => {
    expect(householdTag("hh-1", "home")).toBe("household:hh-1:home");
  });

  it("gives two households different tags for the same area", () => {
    expect(householdTag("hh-1", "home")).not.toBe(householdTag("hh-2", "home"));
  });

  it("refuses an empty household id rather than build a shared tag", () => {
    expect(() => householdTag("", "home")).toThrow();
  });
});

describe("isHomeCacheEnabled", () => {
  it("is off by default", () => {
    expect(isHomeCacheEnabled({})).toBe(false);
  });

  it("is off with Upstash configured but the flag unset", () => {
    expect(isHomeCacheEnabled({ ...UPSTASH })).toBe(false);
  });

  it("is off with the flag on but no Upstash, so it never falls back to per-instance memory", () => {
    expect(isHomeCacheEnabled({ HOME_CACHE: "1" })).toBe(false);
    expect(isHomeCacheEnabled({ HOME_CACHE: "1", UPSTASH_REDIS_REST_URL: UPSTASH.UPSTASH_REDIS_REST_URL })).toBe(false);
  });

  it("is on only for HOME_CACHE=1 with both Upstash variables", () => {
    expect(isHomeCacheEnabled({ HOME_CACHE: "1", ...UPSTASH })).toBe(true);
    expect(isHomeCacheEnabled({ HOME_CACHE: "true", ...UPSTASH })).toBe(false);
    expect(isHomeCacheEnabled({ HOME_CACHE: "0", ...UPSTASH })).toBe(false);
  });
});

describe("invalidateHome", () => {
  beforeEach(() => m.updateTag.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing while the Home cache is off", () => {
    vi.stubEnv("HOME_CACHE", "");
    invalidateHome("hh-1");
    expect(m.updateTag).not.toHaveBeenCalled();
  });

  it("clears the household's Home tag when the cache is on", () => {
    vi.stubEnv("HOME_CACHE", "1");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", UPSTASH.UPSTASH_REDIS_REST_URL);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", UPSTASH.UPSTASH_REDIS_REST_TOKEN);
    invalidateHome("hh-1");
    expect(m.updateTag).toHaveBeenCalledExactlyOnceWith("household:hh-1:home");
  });
});
