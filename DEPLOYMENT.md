# Deployment Runbook

Practical steps for shipping this app to production. Read this before running a
real deploy — it is not a survey of every option, just what to do.

## 1. Migrations

**Rule: production always runs `npx prisma migrate deploy`. Never `npx prisma
migrate dev` outside a developer's own machine.**

`migrate dev` is a development tool — it can prompt interactively for a
migration name, and if it detects drift it will offer to **reset the
database** (drop and recreate it) to get schema and migration history back in
sync. Running that against production data is how you lose the database.
`migrate deploy` is the production-safe counterpart: it only applies
pending migrations from `prisma/migrations/`, never prompts, and never
resets anything.

```bash
npx prisma migrate deploy
```

This project's CLI config lives in `prisma7.config.ts` (Prisma 7's
`prisma.config.ts` replacement for the old `datasource.url` in
`schema.prisma`), so `migrate deploy` picks up `DATABASE_URL` from the
environment automatically — no extra flags needed as long as the env var is
set wherever the command runs.

### Where this runs in a real deploy

Migrations must run **before** the new app code starts serving traffic, and
ideally before the build step that could otherwise fail against a
newer schema. Two concrete mechanisms:

- **Vercel** (this app's likely target): there is no separate release
  phase, so run the migration as part of the build. In the project's
  **Settings → Build & Development Settings → Build Command**, override it to:

  ```
  npx prisma migrate deploy && next build
  ```

  This runs once per deployment, using the `DATABASE_URL` configured in
  **Settings → Environment Variables** for that environment (Production /
  Preview). Note `postinstall` already runs `prisma generate` — that stays
  as-is; you're adding the migration step in front of `next build`, not
  replacing anything.

- **Platforms with a release phase / pre-deploy hook** (Railway, Render,
  Heroku-style platforms): use that hook instead of the build command, since
  it runs once against the new release before it goes live, separately from
  building the image. E.g. Railway's service **Settings → Deploy → Pre-Deploy
  Command**: set it to `npx prisma migrate deploy`. Render's equivalent is
  **Settings → Pre-Deploy Command** on the web service.

Either way, the goal is the same: `migrate deploy` runs exactly once per
release, before the new code paths that depend on the new schema go live.

### Sanity checks

- Never run `migrate dev` against a production `DATABASE_URL`, even by
  accident — double check which `.env` is active before running Prisma
  commands locally against a prod connection string.
- If a migration fails mid-deploy, `migrate deploy` is safe to re-run —
  it only applies migrations not yet recorded as applied.

## 2. Backups

**This is a hosting-provider setting, not something this app can provide.**
There is no in-app backup code — restore capability lives entirely in
whichever Postgres you point `DATABASE_URL` at. Set it up once, outside the
app, before going live.

Recommended baseline: **automated daily backups + point-in-time recovery
(PITR)**, so you can restore to "just before" a bad migration or an
accidental delete, not just to last night's snapshot.

### (a) Managed Postgres (recommended for this app's size) — Neon

Neon is a realistic fit for a small household app and has PITR built in:

1. In the Neon console, open the project → **Backup & restore**.
2. PITR is on by default; set the **retention window** (free tier is a
   shorter fixed window, paid plans allow up to ~30 days — pick the longest
   window your plan allows).
3. To restore: **Branches → Restore**, pick a timestamp, and Neon creates a
   new branch at that point in time. Point `DATABASE_URL` at the restored
   branch (or promote it) instead of trying to restore in place.

(Supabase and RDS both offer the same shape of feature if you land on one of
those instead — Supabase under **Database → Backups** [PITR is a paid
add-on], RDS via **Automated backups + "Enable Point-in-time recovery"**
plus a retention period on the instance. Pick one provider and confirm PITR
is actually turned on — it is often opt-in, not the default.)

### (b) Self-hosting Postgres via `docker-compose.yml` instead

If you run the `postgres` service from this repo's `docker-compose.yml` in
production rather than a managed provider, there is no PITR or automated
snapshotting at all by default — you must build it yourself. Minimum viable
setup:

1. A cron job (on the host, or a small sidecar container) running
   `pg_dump` on a schedule:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   TIMESTAMP=$(date +%Y%m%d-%H%M%S)
   docker exec household-hub-postgres-1 \
     pg_dump -U household household_hub | gzip > "/tmp/household_hub-$TIMESTAMP.sql.gz"

   # Ship it off the host immediately — see step 2.
   aws s3 cp "/tmp/household_hub-$TIMESTAMP.sql.gz" \
     "s3://your-backup-bucket/household-hub/" && rm "/tmp/household_hub-$TIMESTAMP.sql.gz"
   ```

   ```
   # crontab -e
   0 3 * * * /opt/household-hub/backup.sh >> /var/log/household-hub-backup.log 2>&1
   ```

2. **The dump must land somewhere other than the host's own disk** (S3,
   Backblaze B2, another VM, etc.). A backup written next to the
   `household-hub-postgres-data` Docker volume protects against nothing —
   if the host disk fails or the VM is destroyed, the backup goes with it.
   `aws s3 cp` / `rclone copy` to off-host object storage is the minimum bar.
3. This gives you daily recovery points, not true PITR (no continuous WAL
   shipping) — good enough for a personal app, but know the gap: you can
   lose up to a day of data. If that's not acceptable, run `wal-g` or
   `pgbackrest` for continuous WAL archiving instead of just periodic dumps,
   or just use a managed provider from option (a).

## 3. Connection pooling

### The problem

`prisma/schema.prisma`'s `datasource` block has no pooling configuration —
it just declares `provider = "postgresql"`. The actual connection string
comes from `prisma7.config.ts` (`datasource.url: process.env["DATABASE_URL"]`)
and, at runtime, from wherever the app instantiates `PrismaPg` /
`PrismaClient` with `@prisma/adapter-pg`. Each `PrismaClient` you create
opens its own connection pool against Postgres directly — there is no
pooler in front of it today.

That's fine for a long-running server process (one pool, reused for the
process lifetime). It's a real problem on **serverless deploy targets**
like Vercel functions: each function invocation can spin up in its own
isolated execution environment, and under concurrent load you get many of
these simultaneously, each opening its own set of Postgres connections.
A small managed Postgres instance (Neon's default, Supabase's smallest tier,
an RDS `db.t3.micro`) typically caps out around 60–100 connections total —
a handful of concurrent invocations, each opening even a small pool, exhausts
that fast and everyone starts seeing `too many connections` errors.

### The fix

Put a connection pooler in front of Postgres so the _database_ only ever
sees a small, stable number of connections, no matter how many serverless
invocations are hitting it:

- **PgBouncer in transaction mode** — the standard, provider-agnostic
  answer if you're managing Postgres yourself (including the
  `docker-compose.yml` setup above): run PgBouncer alongside Postgres and
  point the app at PgBouncer's port instead of Postgres's.
- **A managed pooler**, if you're on a provider that has one — no
  infrastructure to run yourself:
  - **Neon**: every project has a pooled connection endpoint automatically;
    use the connection string with `-pooler` in the hostname (Neon console →
    **Connection Details** → toggle "Pooled connection") for `DATABASE_URL`.
  - **Supabase**: use the "Transaction" pooler connection string (port
    `6543`) for `DATABASE_URL` instead of the direct one (port `5432`).
  - **Prisma Accelerate** — a managed pooler/cache layer from Prisma itself,
    provider-agnostic; trades a bit of setup (a `prisma://` connection
    string plus an Accelerate extension on the client) for not having to run
    or configure PgBouncer yourself.

### `DATABASE_URL` vs `DIRECT_URL`

This is Prisma's standard pattern once a pooler is in the picture, and it
applies here: transaction-mode pooling doesn't support everything Prisma's
migration engine needs (session-level features like advisory locks), so
`prisma migrate deploy` has to bypass the pooler and talk to Postgres
directly.

- `DATABASE_URL` — the **pooled** connection string. Used by the running
  app (the `PrismaPg` adapter instantiated at runtime) for normal queries.
- `DIRECT_URL` — the **unpooled**, direct-to-Postgres connection string.
  Used only by the Prisma CLI for `migrate deploy` / `migrate dev`.

`prisma7.config.ts`'s `datasource` block declares both:

```typescript
datasource: {
  url: process.env["DATABASE_URL"],
  directUrl: process.env["DIRECT_URL"],
},
```

so once you put a pooler in front of `DATABASE_URL`, `migrate deploy` picks
up `DIRECT_URL` automatically — no code change needed, just the environment
variable below. Leaving `DIRECT_URL` unset (e.g. local dev with no pooler)
is fine; Prisma falls back to `url` for everything.

Add a `DIRECT_URL` value in the environment (see `.env.example`) pointing
at the same database's **direct**, non-pooled connection string (Neon: the
non-`-pooler` hostname; Supabase: port `5432`; self-hosted: Postgres's own
port, bypassing PgBouncer).

### Practical order of operations

1. Stand up the pooler (managed or PgBouncer).
2. Point `DATABASE_URL` at the pooled endpoint, set `DIRECT_URL` to the
   direct endpoint.
3. Re-run `npx prisma migrate deploy` once against the new setup to confirm
   it still works before relying on it in the normal deploy step from
   section 1.

## 4. Monitoring

The app exposes an unauthenticated health check at `GET /api/health`. It runs a trivial
database round-trip (`SELECT 1`) so a `200` response means both the app process and the
database are reachable — not just that the process is up.

- **200** — `{ "status": "ok", "timestamp": "<ISO-8601>" }`. Everything is healthy.
- **503** — `{ "status": "error" }`. The database round-trip failed. Check the server logs
  for the real error (logged server-side, not exposed in the response) — this usually means
  the database is unreachable, out of connections, or misconfigured (bad `DATABASE_URL`).

Point an external uptime monitor at this endpoint, for example:

- [UptimeRobot](https://uptimerobot.com/) or [Better Uptime](https://betteruptime.com/) —
  create an HTTP(S) monitor against `https://<your-domain>/api/health`, checking every 1–5
  minutes, alerting on any non-200 response.
- If hosting on Vercel, Fly.io, or Railway, wire the platform's own built-in health check to
  this same path so the platform can restart/reroute traffic away from an unhealthy instance
  automatically, in addition to (not instead of) an external monitor — a platform-only check
  won't tell you if the whole app is down.

The endpoint requires no authentication by design so monitoring infrastructure can call it
with a plain HTTP GET; it does not (and must not) expose any data beyond the status/timestamp
above.

## 5. Error tracking (Sentry)

Optional, off by default. Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN`
(client — same value) in the deploy environment to activate `@sentry/nextjs`;
leave them unset and the app behaves exactly as it does today, with zero Sentry
network calls. See the comment block above these variables in `.env.example`
for the full list (including the optional `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
`SENTRY_PROJECT` needed only for source-map upload). Requires creating a free
Sentry project (Platform: Next.js) to get a real DSN.

**Privacy:** with Sentry on, the browser sends error details (message, stack trace, page
URL, browser/device type, possibly IP address) to a third party. The privacy policy
(`src/app/privacy/page.tsx`, "Third parties") already describes this as conditional on the
operator enabling it. Keep it that way: don't enable session replay, tracing of user
actions, or `sendDefaultPii` without updating that page — and, since those would go beyond
strictly-necessary processing, adding a real consent flow for them. Likewise, adding any
analytics or other non-essential cookie/localStorage entry means replacing the informational
`CookieNotice` (`src/components/legal/cookie-notice.tsx`) with a consent banner first.

## 6. Rate limiting

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
per 10 minutes _per instance_", multiplying the effective limit by however
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

## 7. Scheduled jobs (notification background sync)

`src/lib/notifications.ts`'s two lazy triggers — **meal-not-logged and
expiring-soon only** (out-of-stock and list-cleared are unaffected: those
still fire synchronously from the Server Action that causes them, e.g.
`recordOutOfStockTransition` called from `adjustQuantityAction` and friends
— see REQUIREMENTS.md's "Notification center" section) — used to run inline
inside `getActiveNotifications` on every notification-bell fetch, which
meant opening the bell could trigger an unbounded number of `Notification`
writes and push sends on what should've been a pure read. Those two now run
only from `GET /api/cron/sync-notifications`, which iterates every household
and syncs both. **This route does nothing on its own — something external
has to call it on a schedule**, and it must never be called without the
`CRON_SECRET` bearer token (see `.env.example`), since unlike `/api/health`
it both writes data and sends push notifications.

**User-facing effect:** a new expiring-soon or meal-not-logged notification
now appears with a delay of up to the cron interval, rather than instantly
the next time someone opens the bell. **How long that delay actually is
depends entirely on which platform/plan runs the schedule below** — it is
not one fixed number:

- **Vercel Hobby** (this app's likely default target): up to **24 hours**,
  since Hobby caps Cron Jobs at once a day (see below).
- **Vercel Pro**: as tight as you configure it, down to once a minute.
- **Railway/Render**: as tight as you configure it — the suggested starting
  point below is every 15 minutes.

None of these two triggers are time-critical to the minute, so a daily delay
on Hobby is an acceptable default, not a bug — but it is a real, user-visible
change from the old "instant on next bell-open" behavior, worth knowing
about before you pick a schedule.

**Deploy prerequisite, not a "do it eventually":** `CRON_SECRET` must be set
in the deploy environment (Vercel: Production **Environment Variables**)
**before, or immediately after, this merges** — not at some later
convenience. Without it, every invocation of this route 401s (see the
route's own `console.error` on a rejected invocation) and the
meal-not-logged/expiring-soon triggers silently stop firing entirely, with
nothing surfacing that to a user — only the platform's cron invocation logs
would show the repeated 401s, and nobody watches those by default. Confirm
the first scheduled run after deploy actually returns `200` (e.g. Vercel's
**Cron Jobs** tab, or the platform's job-run history) rather than assuming
it's working.

### Vercel (this app's likely target)

A `vercel.json` at the repo root already configures this:

```json
{
  "crons": [
    {
      "path": "/api/cron/sync-notifications",
      "schedule": "0 6 * * *"
    }
  ]
}
```

**Once daily by default because of a real platform limit, not a design
choice:** Vercel's Hobby plan only runs Cron Jobs once per day — a
`vercel.json` with a more frequent schedule (e.g. `*/15 * * * *`) fails
*deployment itself*, not just the cron. `0 6 * * *` (06:00 UTC) is a
Hobby-safe default; tune the hour to taste. If this project is on a Pro
plan, tighten the interval as much as you like (down to once a minute) —
Vercel's cron UI under the project's **Cron Jobs** tab shows the resolved
schedule and lets you trigger a run manually to verify it either way. Two
things to set up alongside it:

1. Set `CRON_SECRET` in **Settings → Environment Variables** for the
   environment(s) this should run in. Vercel's own Cron Jobs feature reads
   this same variable and automatically sends it as the
   `Authorization: Bearer <CRON_SECRET>` header on every invocation — no
   extra configuration beyond setting the variable.
2. Vercel Cron Jobs run on the Production environment only, so `vercel.json`
   takes effect once this deploys there — a Preview deployment won't trigger
   it.

### Platforms with their own scheduler (Railway, Render)

`vercel.json`'s `crons` block is Vercel-specific and does nothing on other
platforms — configure the equivalent scheduled job there instead, pointed at
the same route with the same header:

- **Railway**: add a second service in the project from the same repo, set
  its **Settings → Cron Schedule** to `*/15 * * * *`, and its start command
  to a one-shot HTTP call, e.g.
  `curl -f -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sync-notifications`
  (set `CRON_SECRET` on that service too, matching the main app's value).
- **Render**: create a **Cron Job** resource (not a Web Service) pointed at
  this repo, schedule `*/15 * * * *`, and the same `curl` command as above
  as its command, with `CRON_SECRET` set in that job's environment.

Either way, `-f` (`--fail`) makes `curl` exit non-zero on a non-2xx response
(including the 401 you'd get from a missing/wrong secret), so the
platform's own job-failure alerting catches a misconfigured secret instead
of silently no-op'ing every run.

## 8. Pull requests and releases (one-time GitHub setup)

The release workflows (see REQUIREMENTS.md, "Releases & What's new") work
without any of this, but nothing stops a direct push to `master` until you
set it up. Do it once, in the repo's GitHub settings:

1. **Settings → General → Pull Requests**: enable only **Allow squash
   merging**, with the default commit message set to **Pull request title**.
   The PR title is what decides the release.
2. **Settings → Rules → Rulesets → New branch ruleset**, targeting the
   default branch (`master`), enforcement **Active**:
   - **Require a pull request before merging** (0 approvals is fine for a
     single maintainer).
   - **Require status checks to pass**: add `Lint, typecheck, test, build`
     and `Release preview`. They show up in the picker once each has run on
     a PR.
   - **Block force pushes** and **Restrict deletions**.
   - **Bypass list**: add **Repository admin**, so the release token below
     can push the release commit.
3. **Release token**: create a fine-grained personal access token (GitHub →
   Settings → Developer settings) from your admin account, scoped to this
   repository only, with **Contents: Read and write**. Save it as the
   Actions secret **`RELEASE_TOKEN`** (repo Settings → Secrets and variables
   → Actions). Without it, `release.yml` falls back to the default
   `GITHUB_TOKEN`, which the ruleset will refuse.

Each merged releasing PR produces two commits on `master`: the squash merge
and `chore(release): vX.Y.Z [skip ci]` a few seconds later. The hosting
platform deploys both. The second one is the build that shows the new
version under "What's new".
