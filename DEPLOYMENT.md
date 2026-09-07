# Deployment notes

This file collects operational notes for running Household Hub in
production. Other production-readiness tasks add their own sections here
(DB backups/PITR, migrations, connection pooling, health checks, etc.) —
this section covers only the rate limiter.

## Rate limiter durability (multi-instance / serverless deployments)

`src/lib/rate-limit.ts` throttles brute-force attempts against
`loginAction`, `signupAction`, and `joinViaInviteSignupAction`. It has two
backends:

- **In-memory (default)** — a plain `Map` in the Node process. Zero setup,
  but it resets on every deploy/restart and is **not shared** across
  processes or machines.
- **Upstash Redis (optional)** — activates automatically when both
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set (see
  `.env.example`). Upstash's REST API needs no persistent TCP connection, so
  it works from serverless/edge runtimes the same way Resend (see
  `src/lib/email.ts`) does for email — no connection pool to manage, no
  extra infrastructure to run.

### Why this matters

The in-memory backend tracks attempts per-process. If this app ever runs as
more than one instance — multiple containers behind a load balancer,
multiple serverless function invocations, or any horizontally-scaled
deployment — **each instance gets its own independent attempt budget**. A
limit of "10 login attempts per 10 minutes" silently becomes "10 attempts
per 10 minutes *per instance*", multiplying the effective limit by however
many instances are running, with no error or crash to signal it — the app
behaves fine, it's just far less protected than it looks. On a serverless
platform where every invocation can be a fresh process, this can degrade to
close to no rate limiting at all.

**If you deploy this app on more than one instance or on a serverless
platform, set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.**
Without them, the app still runs and still enforces a limit — just one
scoped to whichever instance happens to handle a given request, not to the
key (email address) being attempted. `src/lib/rate-limit.ts` logs a
`console.warn` in production the first time it falls back to the in-memory
limiter, specifically so this isn't a silent gap in production logs — treat
that warning as an action item, not background noise.

### Setup

1. Create a free Redis database at [upstash.com](https://upstash.com)
   (Redis → Create Database). Any region close to your app is fine.
2. Copy the database's REST URL and REST token from its dashboard.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in your
   deployment environment (and locally in `.env` if you want to exercise
   the Redis path in dev).
4. Redeploy. No code changes or migrations are needed — the backend switch
   is automatic based on whether both env vars are present.

If Upstash is configured but a call to it fails (network blip, outage), the
limiter fails over to the in-memory bucket for that single attempt rather
than throwing — a transient Redis error should never turn into a 500 on
login/signup — and logs the failure via `console.error`.
