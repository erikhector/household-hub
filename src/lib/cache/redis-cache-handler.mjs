// PERF-32a: the "use cache: remote" backend, on the same Upstash Redis the
// rate limiter uses (src/lib/rate-limit.ts). next.config.ts registers it as
// `cacheHandlers.remote` only while the Home cache is on
// (src/lib/home-cache-flag.ts); otherwise Next keeps its built-in in-memory
// handler and nothing here is ever loaded.
//
// Plain JavaScript because Next imports this file at runtime by path, outside
// the bundle, so it can't be TypeScript or use the "@/" alias. The handler
// contract is node_modules/next/dist/docs/01-app/03-api-reference/05-config/
// 01-next-config-js/cacheHandlers.md; the comments below say where this one
// departs from its examples and why.
//
// Three rules shape it:
// - A slow or failing Redis is a cache miss, never a slow or broken page.
//   Every read races a short timeout (READ_TIMEOUT_MS) and every error is
//   swallowed into a miss; writes get a longer timeout and only log. Next
//   doesn't wrap get() in a try/catch, so a throw here would be a 500.
// - Invalidation must cross instances. updateTag() on the instance that ran
//   the Server Action calls updateTags(), which writes the tag's time to one
//   sorted set in Redis; refreshTags(), which Next runs once per request
//   before the first read, pulls that set into this instance's memory. If
//   that pull fails, this instance doesn't know what was invalidated, so
//   every read misses until a pull succeeds again: stale data is the one
//   failure worse than a slow page.
// - getExpiration() returns Infinity, which tells Next this handler checks
//   the soft (path) tags itself in get(). So revalidatePath("/dashboard")
//   clears Home entries as well as the explicit household tag does.

import { Redis } from "@upstash/redis";

const KEY_PREFIX = "squirrel:cache:entry:";
const TAGS_KEY = "squirrel:cache:tags";

// A hit pays refreshTags plus get, two Upstash REST round trips; from a
// nearby region each is a few to a few tens of milliseconds. Past this, the
// lookup costs more than the uncached Home batch (about 30 ms median in the
// PERF-22 spike), so give up and run the queries. Kept short because a
// degraded Redis costs every Home render this wait once: refreshTags times
// out, and get() then misses without asking Redis.
export const READ_TIMEOUT_MS = 60;
// Writes run after the response has started streaming (set) or at the end of
// a Server Action (updateTags), so they can wait longer; the bound only keeps
// a hung request from holding the function open.
const WRITE_TIMEOUT_MS = 1000;
// How long an invalidation is remembered, and so the longest an entry may
// live in Redis: an entry must never outlive the record of the tag that
// cleared it, or a pruned tag would bring it back.
export const MAX_ENTRY_AGE_SECONDS = 7 * 24 * 60 * 60;
// Upstash's free tier refuses requests over 1 MB. An entry this big is a
// household with a huge pantry; it just isn't cached.
const MAX_ENTRY_BYTES = 900_000;

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`Redis call timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function logError(operation, error) {
  // Never the key or the value: keys carry household ids, values household data.
  const reason = error instanceof TimeoutError ? "timeout" : error instanceof Error ? error.message : String(error);
  console.error(`[remote-cache] ${operation} failed: ${reason}`);
}

function streamOf(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Builds the handler around a Redis client, so tests can pass a fake one.
 * `redis` null (no Upstash env vars) makes every read a miss and every write
 * a no-op: the flag never registers the handler like that, but a
 * misconfigured deploy should degrade to uncached, not crash.
 *
 * `logOutcomes` (HOME_CACHE_TIMING=1) logs each read's outcome with running
 * counts, for PERF-32b's hit-rate check. Never a key or an id.
 *
 * @param {{ redis: Pick<Redis, "get" | "set" | "zadd" | "zrange" | "zremrangebyscore"> | null, now?: () => number, logOutcomes?: boolean }} options
 */
export function createRedisCacheHandler({ redis, now = Date.now, logOutcomes = false }) {
  // tag -> the time (ms) it was last invalidated, as far as this instance knows.
  const tagTimes = new Map();
  // False until the first successful refreshTags(), and again after a failed
  // one: get() won't serve anything it can't prove is still valid.
  let tagsInSync = false;

  function invalidatedAfter(tags, timestamp) {
    return tags.some((tag) => (tagTimes.get(tag) ?? 0) > timestamp);
  }

  // hit; miss (nothing stored); invalidated (stored, but a tag cleared it);
  // unsynced (refreshTags failed, so nothing is trusted); error (Redis
  // failed or timed out). Per instance, since the process started.
  const outcomes = { hit: 0, miss: 0, invalidated: 0, unsynced: 0, error: 0 };
  function record(outcome, result) {
    outcomes[outcome] += 1;
    if (logOutcomes) console.info(`[remote-cache] get ${outcome} ${JSON.stringify(outcomes)}`);
    return result;
  }

  return {
    async get(cacheKey, softTags) {
      if (!redis) return undefined;
      if (!tagsInSync) return record("unsynced", undefined);
      try {
        const stored = await withTimeout(redis.get(KEY_PREFIX + cacheKey), READ_TIMEOUT_MS);
        if (!stored) return record("miss", undefined);
        // The client parses JSON on the way out; a string means it didn't.
        const data = typeof stored === "string" ? JSON.parse(stored) : stored;
        // An explicit tag (householdTag) or a soft tag (a revalidatePath'd
        // route) cleared after this entry was made: it's out of date, so a
        // miss and a fresh render. revalidateTag(tag, "max") would allow
        // serving it while it refreshes; nothing here uses that, so every
        // invalidation is treated as immediate.
        if (invalidatedAfter(data.tags, data.timestamp) || invalidatedAfter(softTags, data.timestamp)) {
          return record("invalidated", undefined);
        }
        // No age check: Next compares timestamp with expire itself.
        return record("hit", {
          value: streamOf(Buffer.from(data.value, "base64")),
          tags: data.tags,
          stale: data.stale,
          timestamp: data.timestamp,
          expire: data.expire,
          revalidate: data.revalidate,
        });
      } catch (error) {
        logError("get", error);
        return record("error", undefined);
      }
    },

    async set(cacheKey, pendingEntry) {
      try {
        const entry = await pendingEntry;
        // Read the single-use stream to the end, then keep only the bytes.
        const bytes = Buffer.from(await new Response(entry.value).arrayBuffer());
        if (!redis || bytes.byteLength > MAX_ENTRY_BYTES) return;
        const ttl = Math.min(
          Number.isFinite(entry.expire) ? Math.max(1, Math.ceil(entry.expire)) : MAX_ENTRY_AGE_SECONDS,
          MAX_ENTRY_AGE_SECONDS,
        );
        await withTimeout(
          redis.set(
            KEY_PREFIX + cacheKey,
            {
              value: bytes.toString("base64"),
              tags: entry.tags,
              stale: entry.stale,
              timestamp: entry.timestamp,
              expire: entry.expire,
              revalidate: entry.revalidate,
            },
            { ex: ttl },
          ),
          WRITE_TIMEOUT_MS,
        );
      } catch (error) {
        // A lost write is a later miss. Rejecting would surface as a failed
        // background task instead (see the docs' "Error Handling").
        logError("set", error);
      }
    },

    async refreshTags() {
      if (!redis) return;
      try {
        const since = now() - MAX_ENTRY_AGE_SECONDS * 1000;
        const rows = await withTimeout(
          redis.zrange(TAGS_KEY, since, "+inf", { byScore: true, withScores: true }),
          READ_TIMEOUT_MS,
        );
        // [member, score, member, score, ...]
        for (let i = 0; i + 1 < rows.length; i += 2) {
          const tag = String(rows[i]);
          const time = Number(rows[i + 1]);
          if (time > (tagTimes.get(tag) ?? 0)) tagTimes.set(tag, time);
        }
        tagsInSync = true;
      } catch (error) {
        tagsInSync = false;
        logError("refreshTags", error);
      }
    },

    async getExpiration(_tags) {
      // get() checks the soft tags itself (see the header comment).
      return Infinity;
    },

    async updateTags(tags) {
      if (tags.length === 0) return;
      const time = now();
      // This instance knows at once, whatever happens to the write below.
      for (const tag of tags) tagTimes.set(tag, time);
      if (!redis) return;
      try {
        await withTimeout(
          Promise.all([
            redis.zadd(TAGS_KEY, ...tags.map((tag) => ({ score: time, member: tag }))),
            // Forget invalidations older than any entry can be, so the set
            // refreshTags reads stays small.
            redis.zremrangebyscore(TAGS_KEY, 0, time - MAX_ENTRY_AGE_SECONDS * 1000),
          ]),
          WRITE_TIMEOUT_MS,
        );
      } catch (error) {
        // Other instances won't hear of this one; their entries still lapse
        // at the cached function's revalidate time (src/lib/home-data.ts).
        logError("updateTags", error);
      }
    },
  };
}

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * The Upstash client's options. Retries off: by default the client retries a
 * failed request several times with backoff, which would turn one failing
 * read into seconds of waiting, where a miss is the right answer.
 */
export function redisOptions(url, token) {
  return { url, token, retry: { retries: 0 } };
}

export default createRedisCacheHandler({
  redis: url && token ? new Redis(redisOptions(url, token)) : null,
  logOutcomes: process.env.HOME_CACHE_TIMING === "1",
});
