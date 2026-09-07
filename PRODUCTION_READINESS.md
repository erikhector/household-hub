# Production readiness — master todo

Tracking doc for the production-readiness push. Each task below is being
(or will be) delegated to an isolated sub-agent working in its own git
worktree/branch, so tasks can run in parallel without stepping on each
other's files. The orchestrating session reviews, tests, and merges each
branch into `master` as it lands.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to master · `[!]` blocked / needs a human decision.

## Wave 1 — independent, parallel (no shared files, no schema changes)

- [~] **A. CSP header** — add `Content-Security-Policy` to `next.config.ts`,
      verify OCR (tesseract.js) and barcode scanning still work in-browser.
- [x] **B. Document `AUTH_SECRET`** — add it to `.env.example` +
      README, with `npx auth secret` generation instructions. Merged
      `4b470b9`. 334/334 tests pass; no insecure fallback found in code.
- [~] **C. CI pipeline** — `.github/workflows/ci.yml` running lint,
      typecheck, `vitest run`, and build on every PR/push.
- [~] **D. `npm audit` fix pass** — resolve/assess the mysql2/prisma
      transitive vulnerabilities.
- [~] **E. Health check endpoint** — `/api/health` + uptime-monitoring
      notes in the deployment runbook.
- [x] **F. Structured logging** — replace raw `console.*` calls with a
      small logger utility (secret-redacting). Merged; new `src/lib/logger.ts`,
      4 call sites swapped (errors.ts, email.ts, error.tsx, global-error.tsx).
      334/334 tests pass.
- [~] **G. Terms of Service + Privacy Policy pages** — draft content,
      footer links; flagged for legal review before real launch.
- [~] **H. Production deployment runbook** (`DEPLOYMENT.md`) — DB
      backups/PITR, `prisma migrate deploy`, connection pooling
      (PgBouncer / Prisma Accelerate).
- [~] **I. Rate limiter durability** — document the single-instance
      constraint clearly + add an optional Redis/Upstash-backed limiter
      behind an env var, falling back to the current in-memory one.
- [~] **J. Error tracking (Sentry)** — wire up `@sentry/nextjs` behind a
      `SENTRY_DSN` env var (no-op when unset, like Resend today).

## Wave 2 — sequential (all touch `prisma/schema.prisma`, `auth.ts`, `email.ts`)

Run one at a time, each rebased on the previous one's merge, to avoid
Prisma migration-numbering conflicts.

- [ ] **K. Password reset / forgot-password flow**
- [ ] **L. Email verification on signup**
- [ ] **M. Account deletion + GDPR data export**

## Wave 3 — after Wave 2 lands

- [ ] **N. End-to-end smoke test** for the golden path (signup → verify →
      create household → add inventory item → shopping list → budget
      transaction), since it exercises the auth flows Wave 2 changes.

## Notes for any agent resuming a task after an interruption

Each task's worktree has its own `AGENT_PROGRESS.md` at its root — read
that first, it reflects true current progress and next steps.
