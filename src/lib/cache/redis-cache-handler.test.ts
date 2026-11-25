// PERF-32a: the Redis "use cache: remote" handler, against an in-memory
// stand-in for the Upstash client (no network, as AGENTS.md's "Testing" asks).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ENTRY_AGE_SECONDS,
  READ_TIMEOUT_MS,
  createRedisCacheHandler,
} from "@/lib/cache/redis-cache-handler.mjs";

type Handler = ReturnType<typeof createRedisCacheHandler>;

// Just the five calls the handler makes, with the Upstash client's shapes:
// values come back already parsed, and a by-score zrange with scores is a
// flat [member, score, ...] list.
function fakeRedis() {
  const values = new Map<string, unknown>();
  const zset = new Map<string, number>();
  return {
    values,
    zset,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, _opts?: { ex: number }) => {
      values.set(key, value);
      return "OK";
    }),
    zadd: vi.fn(async (_key: string, ...members: { score: number; member: string }[]) => {
      for (const { score, member } of members) zset.set(member, score);
      return members.length;
    }),
    zrange: vi.fn(async (_key: string, min: number) =>
      [...zset].filter(([, score]) => score >= min).flatMap(([member, score]) => [member, score]),
    ),
    zremrangebyscore: vi.fn(async (_key: string, min: number, max: number) => {
      for (const [member, score] of zset) if (score >= min && score <= max) zset.delete(member);
      return 0;
    }),
  };
}

function entry(text: string, tags: string[], timestamp: number) {
  return {
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
    tags,
    stale: 30,
    timestamp,
    expire: 3600,
    revalidate: 300,
  };
}

async function textOf(result: Awaited<ReturnType<Handler["get"]>>) {
  expect(result).toBeDefined();
  return new Response(result!.value).text();
}

const TAG = "household:hh-1:home";

describe("createRedisCacheHandler", () => {
  let now: number;
  let redis: ReturnType<typeof fakeRedis>;
  let handler: Handler;

  beforeEach(() => {
    now = 1_000_000;
    redis = fakeRedis();
    handler = createRedisCacheHandler({ redis: redis as never, now: () => now });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("serves what it stored, as a fresh stream each time (hit)", async () => {
    await handler.set("k", Promise.resolve(entry("home data", [TAG], now)));
    await handler.refreshTags();

    const first = await handler.get("k", []);
    expect(await textOf(first)).toBe("home data");
    expect(first).toMatchObject({ tags: [TAG], timestamp: now, expire: 3600, revalidate: 300 });
    expect(await textOf(await handler.get("k", []))).toBe("home data");
  });

  it("gives the Redis key a TTL from the entry's expire", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining("k"), expect.anything(), { ex: 3600 });
  });

  it("never lets an entry outlive the invalidations it's checked against", async () => {
    await handler.set("k", Promise.resolve({ ...entry("x", [TAG], now), expire: Infinity }));
    expect(redis.set).toHaveBeenCalledWith(expect.anything(), expect.anything(), { ex: MAX_ENTRY_AGE_SECONDS });
  });

  it("misses when nothing is stored", async () => {
    await handler.refreshTags();
    expect(await handler.get("missing", [])).toBeUndefined();
  });

  it("misses until tags have been synced, since it can't tell what was invalidated", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    expect(await handler.get("k", [])).toBeUndefined();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it("falls back to a miss when Redis is slower than the read timeout", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    await handler.refreshTags();
    vi.useFakeTimers();
    redis.get.mockImplementationOnce(() => new Promise(() => {}));

    const result = handler.get("k", []);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await result).toBeUndefined();
  });

  it("turns a Redis error on read into a miss, not a thrown render error", async () => {
    await handler.refreshTags();
    redis.get.mockRejectedValueOnce(new Error("boom"));
    expect(await handler.get("k", [])).toBeUndefined();
  });

  it("swallows a failed write", async () => {
    redis.set.mockRejectedValueOnce(new Error("boom"));
    await expect(handler.set("k", Promise.resolve(entry("x", [TAG], now)))).resolves.toBeUndefined();
  });

  it("misses once the entry's tag is invalidated on this instance", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    await handler.refreshTags();
    now += 1000;
    await handler.updateTags([TAG]);
    expect(await handler.get("k", [])).toBeUndefined();
  });

  it("learns another instance's invalidation through refreshTags", async () => {
    const other = createRedisCacheHandler({ redis: redis as never, now: () => now });
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    await handler.refreshTags();
    expect(await handler.get("k", [])).toBeDefined();

    now += 1000;
    await other.updateTags([TAG]);
    expect(redis.zadd).toHaveBeenCalledWith(expect.any(String), { score: now, member: TAG });

    await handler.refreshTags();
    expect(await handler.get("k", [])).toBeUndefined();
  });

  it("keeps serving an entry made after the invalidation", async () => {
    await handler.updateTags([TAG]);
    now += 1000;
    await handler.set("k", Promise.resolve(entry("fresh", [TAG], now)));
    await handler.refreshTags();
    expect(await textOf(await handler.get("k", []))).toBe("fresh");
  });

  it("leaves other households' entries alone", async () => {
    await handler.set("k", Promise.resolve(entry("other", ["household:hh-2:home"], now)));
    await handler.refreshTags();
    now += 1000;
    await handler.updateTags([TAG]);
    expect(await textOf(await handler.get("k", []))).toBe("other");
  });

  it("honours soft (path) tags, so revalidatePath also clears the entry", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    await handler.refreshTags();
    now += 1000;
    await handler.updateTags(["_N_T_/dashboard"]);
    expect(await handler.get("k", ["_N_T_/layout", "_N_T_/dashboard"])).toBeUndefined();
    expect(await handler.getExpiration(["_N_T_/dashboard"])).toBe(Infinity);
  });

  it("misses everything after a failed refreshTags, until one succeeds", async () => {
    await handler.set("k", Promise.resolve(entry("x", [TAG], now)));
    await handler.refreshTags();
    redis.zrange.mockRejectedValueOnce(new Error("boom"));
    await handler.refreshTags();
    expect(await handler.get("k", [])).toBeUndefined();

    await handler.refreshTags();
    expect(await handler.get("k", [])).toBeDefined();
  });

  it("prunes invalidations older than any entry can be", async () => {
    await handler.updateTags([TAG]);
    expect(redis.zremrangebyscore).toHaveBeenCalledWith(expect.any(String), 0, now - MAX_ENTRY_AGE_SECONDS * 1000);
  });

  it("without a Redis client, misses and never throws", async () => {
    const bare = createRedisCacheHandler({ redis: null, now: () => now });
    await bare.set("k", Promise.resolve(entry("x", [TAG], now)));
    await bare.refreshTags();
    await bare.updateTags([TAG]);
    expect(await bare.get("k", [])).toBeUndefined();
  });
});
