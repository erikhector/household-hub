import { Redis } from "@upstash/redis";

// Rate limiter with two backends:
//
// - In-memory (default): a Map-based fixed-window counter. Deliberately
//   simple for this app's scale (a handful of households on one server
//   instance), but it resets on every deploy/restart and doesn't share
//   state across multiple instances — a brute-force *speed bump*, not a
//   hard guarantee, for loginAction/signupAction/joinViaInviteSignupAction
//   (see src/lib/actions/auth.ts, src/lib/actions/household.ts).
// - Redis (optional): backed by Upstash's REST API, so it needs no
//   persistent TCP connection — the same "least friction" reasoning
//   src/lib/email.ts already uses for Resend, and it fits serverless/edge
//   runtimes that can't hold a pooled connection open. Activates
//   automatically when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
//   are both set (see .env.example, DEPLOYMENT.md); shares one bucket store
//   across every instance/invocation, closing the gap above.
//
// checkRateLimit's signature and behavior contract are identical either
// way: (key, limit, windowMs) -> allowed, and callers must never reset a
// bucket on success (that would let an attacker who eventually guesses
// right, or who cycles between valid/invalid inputs, dodge the limit); the
// window elapsing is the only way through. The one unavoidable difference
// versus the old implementation is that the Redis path does network I/O, so
// this is now `async` — every call site already lives inside an `async`
// Server Action, so this only meant adding `await`.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounds how much memory a flood of distinct keys (e.g. many different
// emails) can consume before old entries are swept. Only applies to the
// in-memory backend — Redis keys expire on their own (see `px` below).
const MAX_TRACKED_KEYS = 10_000;

function sweepExpired(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function checkRateLimitMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweepExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) return false;

  existing.count += 1;
  return true;
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis =
  upstashUrl && upstashToken ? new Redis({ url: upstashUrl, token: upstashToken }) : null;

let warnedAboutMemoryFallback = false;

// Warns once (per process) that this deployment is running the durability
// gap the module comment above describes. There's no reliable way to detect
// "multiple instances" from inside one of them, so this only fires in
// production — local dev and tests are expected to run single-instance with
// nothing configured, and warning there on every run would just be noise
// that trains people to ignore it.
function warnIfNoRedisConfigured() {
  if (redis || warnedAboutMemoryFallback) return;
  warnedAboutMemoryFallback = true;
  if (process.env.NODE_ENV !== "production") return;

  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set — " +
      "falling back to the in-memory rate limiter. That limiter resets on every " +
      "restart and does NOT share state across instances, so on any multi-instance " +
      "or serverless deployment each instance/invocation gets its own independent " +
      "budget and brute-force protection on login/signup silently degrades. Set " +
      "both env vars (see .env.example and DEPLOYMENT.md) if this app runs on " +
      "more than one instance.",
  );
}

async function checkRateLimitRedis(key: string, limit: number, windowMs: number): Promise<boolean> {
  const redisKey = `ratelimit:${key}`;
  // SET NX PX anchors a fresh window to this first attempt, exactly like the
  // in-memory bucket's `resetAt`. When that fails (key already exists),
  // INCR records this attempt without touching the key's existing TTL —
  // Redis leaves TTL untouched on INCR — so the window still expires
  // `windowMs` after the *first* attempt, matching the in-memory semantics
  // (a fixed window per key, not a rolling one).
  const created = await redis!.set(redisKey, 1, { nx: true, px: windowMs });
  if (created) return true;

  const count = await redis!.incr(redisKey);
  return count <= limit;
}

/**
 * Returns true if `key` is currently allowed one more attempt within
 * `limit` attempts per `windowMs`, and records this attempt. Once the limit
 * is hit, every call returns false until the window rolls over — callers
 * should NOT reset the bucket on success (that would let an attacker who
 * eventually guesses right, or who cycles between valid/invalid inputs,
 * dodge the limit); the window elapsing is the only way through.
 *
 * Backed by Redis (Upstash REST API) across every instance when
 * UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are set; otherwise falls
 * back to the in-process Map above. If Redis is configured but a call to it
 * fails (network blip, outage), this fails over to the in-memory bucket for
 * that attempt rather than throwing — a transient Redis error should never
 * turn into a 500 on login/signup, and an imperfect rate limit during an
 * outage beats none at all.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (!redis) {
    warnIfNoRedisConfigured();
    return checkRateLimitMemory(key, limit, windowMs);
  }

  try {
    return await checkRateLimitRedis(key, limit, windowMs);
  } catch (error) {
    console.error(
      "[rate-limit] Upstash Redis call failed; falling back to the in-memory limiter for this attempt",
      error,
    );
    return checkRateLimitMemory(key, limit, windowMs);
  }
}

/** Test-only: clears all tracked buckets so tests don't leak state into each other. */
export function _resetRateLimitsForTests() {
  buckets.clear();
  warnedAboutMemoryFallback = false;
}
