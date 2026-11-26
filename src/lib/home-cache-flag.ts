// PERF-32a: the one switch for the Home cache. It's read in two places:
// next.config.ts, which registers the Redis handler for "use cache: remote"
// only when it's on, and src/lib/household-cache.ts / src/lib/home-data.ts,
// which pick the cached Home batch and send its invalidations. Both read the
// same env, so a deploy is either fully on or fully off.
//
// On only when HOME_CACHE is exactly "1" AND both Upstash variables are set:
// without a shared store the remote handler would fall back to Next's
// per-instance memory, which on serverless rarely hits and never sees
// another instance's invalidation. Off (the default) means the Home page
// runs the same queries it always has and no Server Action sends a tag.
// Changing it needs a redeploy, since next.config.ts reads it at build time.
// See DEPLOYMENT.md, "Home cache (PERF-32)".
//
// No imports on purpose: next.config.ts loads this file too.
export function isHomeCacheEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HOME_CACHE === "1" && !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN;
}
