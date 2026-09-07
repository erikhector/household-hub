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

Put a connection pooler in front of Postgres so the *database* only ever
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

**This app currently has no `DIRECT_URL` split** — `prisma7.config.ts` only
declares `datasource.url`. It works today because there's no pooler in
front of `DATABASE_URL` yet. The moment you put PgBouncer/Neon-pooler/
Supabase-pooler in front of `DATABASE_URL` for the running app, you need to
wire up the direct URL too, or `migrate deploy` will fail or silently
misbehave against the pooler. Two changes, both small:

1. Add a `DIRECT_URL` value in the environment (see `.env.example` — the
   variable is now documented there) pointing at the same database's
   **direct**, non-pooled connection string (Neon: the non-`-pooler`
   hostname; Supabase: port `5432`; self-hosted: Postgres's own port,
   bypassing PgBouncer).
2. Add it to `prisma7.config.ts`'s `datasource` block:

   ```typescript
   datasource: {
     url: process.env["DATABASE_URL"],
     directUrl: process.env["DIRECT_URL"],
   },
   ```

   This is a one-line code change, intentionally **not** made as part of
   this docs pass — do it at the same time you actually put a pooler in
   front of `DATABASE_URL`, not before, since until then `DIRECT_URL` has
   nothing to do.

### Practical order of operations

1. Stand up the pooler (managed or PgBouncer).
2. Point `DATABASE_URL` at the pooled endpoint, set `DIRECT_URL` to the
   direct endpoint.
3. Make the one-line `prisma7.config.ts` change above.
4. Re-run `npx prisma migrate deploy` once against the new setup to confirm
   it still works before relying on it in the normal deploy step from
   section 1.
