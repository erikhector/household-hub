# Task H: Production Deployment Runbook — Progress

- [x] Explored repo: read `prisma/schema.prisma`, `prisma7.config.ts`, `docker-compose.yml`, `.env.example`
- [x] Confirmed `PRODUCTION_READINESS.md` and `DEPLOYMENT.md` do not exist yet in this worktree (not in git history either) — proceeding from the task description given directly, creating `DEPLOYMENT.md` fresh
- [x] Consulted `prisma-database-setup` skill for current Prisma 7 pooling/directUrl guidance
- [x] Write `DEPLOYMENT.md` at repo root:
  - [x] Migrations section (`prisma migrate deploy`, Vercel build-command override example, Railway/Render pre-deploy hook)
  - [x] Backups section (Neon managed PITR + self-hosted pg_dump cron to off-host storage)
  - [x] Connection pooling section (PgBouncer/Accelerate/Neon/Supabase pooler, DATABASE_URL vs DIRECT_URL)
- [x] Decide on `DIRECT_URL`: added additive block to `.env.example`; documented the one-line `prisma7.config.ts` follow-up wiring needed once a pooler is actually introduced (not made now, per "no application code changes")
- [x] Run `npm run lint` — 1 pre-existing error in `src/components/theme/use-theme-cycle.ts` (untouched by this task, predates it), unrelated to the docs-only diff
- [x] Run `npx tsc --noEmit` — clean (0 errors) after running `next build` once to generate `.next/types` (a fresh checkout needs a build before `tsc` sees the `PageProps`/`LayoutProps` globals; unrelated to this change)
- [x] Run `npm run test` — 334/334 tests passed, unaffected
- [x] Commit work with required co-author trailer
- [x] Final report
