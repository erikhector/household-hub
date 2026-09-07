// Minimal in-process sliding-window rate limiter — no Redis/external store.
// Deliberately simple for this app's scale (a handful of households on one
// server instance): it resets on every deploy/restart and doesn't share
// state across multiple instances, so it's a brute-force *speed bump*, not a
// hard guarantee. That's still a real improvement over the previous
// no-limit-at-all state for loginAction/signupAction/joinViaInviteSignupAction
// (see src/lib/actions/auth.ts, src/lib/actions/household.ts) — it turns an
// unthrottled password-guessing script into one that can only try a few
// times a minute per key. If this app ever runs multiple instances behind a
// load balancer, replace the Map below with a shared store (e.g. Redis)
// instead of trusting this as-is.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounds how much memory a flood of distinct keys (e.g. many different
// emails) can consume before old entries are swept.
const MAX_TRACKED_KEYS = 10_000;

function sweepExpired(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns true if `key` is currently allowed one more attempt within
 * `limit` attempts per `windowMs`, and records this attempt. Once the limit
 * is hit, every call returns false until the window rolls over — callers
 * should NOT reset the bucket on success (that would let an attacker who
 * eventually guesses right, or who cycles between valid/invalid inputs,
 * dodge the limit); the window elapsing is the only way through.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
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

/** Test-only: clears all tracked buckets so tests don't leak state into each other. */
export function _resetRateLimitsForTests() {
  buckets.clear();
}
