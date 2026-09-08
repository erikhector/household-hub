# Production readiness — master todo

Tracking doc for the production-readiness push. Each task below is being
(or will be) delegated to an isolated sub-agent working in its own git
worktree/branch, so tasks can run in parallel without stepping on each
other's files. The orchestrating session reviews, tests, and merges each
branch into `master` as it lands.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to master · `[!]` blocked / needs a human decision.

## Wave 1 — independent, parallel (no shared files, no schema changes)

- [x] **A. CSP header** — added to `next.config.ts`; verified live against
      tesseract.js OCR and barcode scanning (jsdelivr CDN + wasm + blob
      worker allowances). Merged. Found & spawned a follow-up: the existing
      `Permissions-Policy: camera=()` header blocks the barcode scanner's
      `getUserMedia()` in a real browser — needs its own fix.
- [x] **B. Document `AUTH_SECRET`** — add it to `.env.example` +
      README, with `npx auth secret` generation instructions. Merged
      `4b470b9`. 334/334 tests pass; no insecure fallback found in code.
- [x] **C. CI pipeline** — `.github/workflows/ci.yml` running lint,
      `next typegen` + typecheck, `vitest run`, and build on every push/PR.
      Merged. Verified empirically: no DB service container needed (all
      Prisma-touching tests are mocked) and no env vars needed at build time.
- [x] **D. `npm audit` fix pass** — no clean fix exists yet (latest stable
      Prisma 7.10.0 still pulls vulnerable `mysql2`/`deepmerge-ts`
      transitively, dev-only, unused at runtime since this app is
      Postgres-only via `@prisma/adapter-pg`). Documented as an accepted,
      monitored risk rather than force-downgrading to Prisma 6. Merged (docs
      only, no code change).
- [x] **E. Health check endpoint** — `GET /api/health` (DB round-trip via
      `SELECT 1`, 200/503, no auth) + tests + `DEPLOYMENT.md` Monitoring
      section. Merged.
- [x] **F. Structured logging** — replace raw `console.*` calls with a
      small logger utility (secret-redacting). Merged; new `src/lib/logger.ts`,
      4 call sites swapped (errors.ts, email.ts, error.tsx, global-error.tsx).
      334/334 tests pass.
- [x] **G. Terms of Service + Privacy Policy pages** — draft content
      grounded in the actual schema/data flows (no analytics/trackers
      confirmed by grep, Resend as the only third-party flow), footer +
      signup-consent links, EN-only page bodies (nav/consent chrome is
      EN/SV). Merged. **Flagged for legal review before real end-users.**
- [x] **H. Production deployment runbook** (`DEPLOYMENT.md`) — migrations
      (`migrate deploy` via Vercel build command / Railway pre-deploy hook),
      backups (Neon PITR / self-hosted `pg_dump` off-host), connection
      pooling (`DATABASE_URL` vs `DIRECT_URL`, added to `.env.example`).
      Merged; hand-combined with E/I/J's sections into one file (see note
      below on manual conflict resolution).
- [x] **I. Rate limiter durability** — real optional Upstash Redis backend
      (`UPSTASH_REDIS_REST_URL`/`_TOKEN`), same fixed-window semantics,
      falls back to in-memory + a production `console.warn` when unset.
      `checkRateLimit` is now `async` (necessary for real network I/O);
      the 3 call sites got `await` added. Merged, 344/344 tests pass.
- [x] **J. Error tracking (Sentry)** — `@sentry/nextjs` wired via
      `src/instrumentation.ts`/`instrumentation-client.ts`, fully no-op with
      zero Sentry env vars (verified: build/dev/test all pass unconfigured).
      Hooked into `toFriendlyError` and both error boundaries alongside
      (not instead of) task F's logger calls. Merged — required manual
      conflict resolution against F (errors.ts/error.tsx/global-error.tsx)
      and A (next.config.ts, auto-merged cleanly).
      **Needs a human:** create a free Sentry project to get a real DSN.

**Wave 1 status: all 10 tasks merged to master.** Final full-suite
verification (lint/typecheck/test/build) in progress after the J merge.

### Manual merge notes (for anyone reading history later)

Three tasks (E, H, I) each independently created `DEPLOYMENT.md` from
scratch in their own worktree (none could see the others' work). These were
hand-combined into one file with 6 sections (Migrations, Backups, Pooling,
Monitoring, Sentry, Rate limiting) rather than picked one-over-the-other.
`.env.example` conflicts (B/H/I/J all appending blocks) were pure
append-order conflicts, resolved by keeping all blocks. `errors.ts`/
`error.tsx`/`global-error.tsx` conflicts between F (logger) and J (Sentry)
were resolved by keeping both calls side by side.

## Wave 2 — sequential (all touch `prisma/schema.prisma`, `auth.ts`, `email.ts`)

Run one at a time, each rebased on the previous one's merge, to avoid
Prisma migration-numbering conflicts.

- [x] **K. Password reset / forgot-password flow** — new `PasswordResetToken`
      model + migration (1hr expiry), `requestPasswordResetAction`/
      `resetPasswordAction`, new `/forgot-password` + `/reset-password/[token]`
      pages, full EN/SV i18n. Enumeration-safe (identical generic response
      whether or not the account exists), reset link is email-only (never
      shown on-screen, unlike household invites), old tokens invalidated on
      each new request and on successful reset. Merged, 358/358 tests pass.
      **Live-verified end-to-end in browser** (not just mocked tests): request
      → real DB token → reset → login with new password → reused token
      correctly rejected as invalid. One snag caught during live verification:
      the already-running dev server had a stale in-memory Prisma Client from
      before the migration/merge (`prisma.passwordResetToken` was `undefined`
      until the dev server was restarted) — not a real app bug, but a
      reminder to restart the dev server after any schema-changing merge
      before trusting a live check.
      **Known follow-up, not fixed here:** NextAuth JWT sessions aren't
      invalidated by a password change — a stolen session cookie survives a
      reset. Same pre-existing gap as `updatePasswordAction`.
- [x] **L. Email verification on signup** — new `EmailVerificationToken` model
      + `User.emailVerifiedAt` + migration (36hr expiry), `signupAction` now
      sends a verification email (non-blocking), new `verifyEmailAction` +
      `resendVerificationEmailAction`, `/verify-email/[token]` page, dashboard
      banner. **Soft-gated as scoped** — full access regardless, just a
      dismissible-by-verifying banner. Merged, 371/371 tests pass.
      Correction to my own earlier task brief: `src/proxy.ts` (Next 16's
      `middleware.ts` rename) *does* do session-based route gating
      (redirects unauthenticated users off `/dashboard`) — I'd told the
      agent no such layer existed. Doesn't change the soft-gate decision
      (proxy.ts is Edge/JWT-only, no Prisma access, so gating on
      `emailVerifiedAt` there would need JWT/session-refresh plumbing
      anyway) but noting the correction for accuracy.
      **Live-verified end-to-end in browser**: banner renders for an
      unverified account, resend action creates a fresh DB token (and
      correctly surfaces a real "couldn't send" error here, unlike password
      reset, since there's no enumeration concern for an already-logged-in
      caller), valid-token verify works and clears the banner, an
      already-verified re-visit is handled idempotently (harmless React
      Strict Mode double-invoke of the auto-submit effect in dev landed on
      the "already verified" branch — by design), invalid token correctly
      rejected.

## Wave 3 — after Wave 2 lands

- [ ] **N. End-to-end smoke test** for the golden path (signup → verify →
      create household → add inventory item → shopping list → budget
      transaction), since it exercises the auth flows Wave 2 changes.

## Notes for any agent resuming a task after an interruption

Each task's worktree has its own `AGENT_PROGRESS.md` at its root — read
that first, it reflects true current progress and next steps.
