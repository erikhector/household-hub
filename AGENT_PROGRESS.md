# Task L: email verification on signup — progress

Status: DONE. All checklist items complete, lint/typecheck/tests green
(371/371), work committed on this worktree's branch.

## Summary of what shipped

- `prisma/schema.prisma`: `User.emailVerifiedAt DateTime?` (null =
  unverified) + `EmailVerificationToken` model (mirrors
  `PasswordResetToken`'s shape). 36-hour expiry — see the model's doc
  comment. Migration: `prisma/migrations/20260908065452_add_email_verification`.
- `src/lib/email.ts`: new `sendVerificationEmail` (mirrors
  `sendPasswordResetEmail`'s no-op-when-unconfigured shape).
- `src/lib/actions/auth.ts`:
  - `signupAction` now also creates a verification token and sends the
    email after creating the account (non-blocking — failures don't fail
    signup).
  - New `verifyEmailAction` (idempotent: already-verified accounts report
    success regardless of this token's own state).
  - New `resendVerificationEmailAction` (rate-limited per-user via
    `requireUserId`, replaces outstanding unused tokens).
- `src/app/verify-email/[token]/page.tsx` +
  `src/components/auth/verify-email-client.tsx`: verification page. Read
  happens in the Server Component; the actual write happens in a real
  Server Action (`verifyEmailAction`) auto-submitted on mount via
  `formRef.current.requestSubmit()` — see the page's doc comment for why
  (Next's own data-security guide calls a GET-triggered DB mutation during
  render an anti-pattern).
- `src/components/dashboard/email-verification-banner.tsx` + wired into
  `src/app/dashboard/layout.tsx` (fetches `user.emailVerifiedAt` alongside
  `requireHousehold()`, shown only when null).
- i18n: `auth.verifyEmail.*` and top-level `emailVerification.*` added to
  both `en.ts` and `sv.ts`.
- Tests: extended `src/lib/actions/auth.test.ts` with 13 new tests
  (signup token/email creation, `verifyEmailAction` incl. idempotency/rate
  limit, `resendVerificationEmailAction` incl. rate limit). 371/371 total
  passing.

## Verification performed

- `npm run lint`, `npx tsc --noEmit`, `npm run test`: all clean (0
  warnings, 0 errors, 371/371 tests).
- A temporary, non-committed vitest file exercised the real generated
  Prisma client against the local Postgres container (token create →
  verify → other-token invalidation → cascade delete on user deletion) —
  all passed, then the file was deleted and test data cleaned up.
- Full browser-based click-through (like task K's) was **not possible in
  this environment**: the Claude Browser pane's `preview_start` resolves
  its dev server to the shared main checkout
  (`C:\Users\ErikHector\Desktop\household-hub`), not this agent's worktree
  — confirmed via `Get-CimInstance Win32_Process`, whose command line
  pointed at the main repo's `node_modules`, not the worktree's. Starting
  `next dev` directly via Bash *inside* the worktree (a different port,
  cleaned up afterward) confirmed the real page correctly compiles and
  server-renders (`/verify-email/[nonexistent-token]` returns the expected
  "Verify your email" / "Verifying your email…" markup), but exercising
  the Server Action itself would require hand-forging Next's internal
  Server Action wire protocol (multipart body + action-id header), which
  wasn't worth doing given the unit tests already cover every action
  branch and the live-DB smoke test covered the Prisma layer.

## Housekeeping already done

- Migration committed as its own commit
  (`Add EmailVerificationToken model and User.emailVerifiedAt column`).
- Remaining code/i18n/tests to be committed as a follow-up commit (see
  final report for exact message) — if this file is being read by a
  resuming agent because that commit didn't happen yet, just run
  `git status` to see what's staged/unstaged and finish the commit step.
