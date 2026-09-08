# Task K — Password reset / forgot-password flow

Status: **done**. All checklist items complete, all verification passed.

## Plan

- [x] Explored conventions: `prisma/schema.prisma` (Invitation model),
      `src/lib/actions/auth.ts` (signupAction/loginAction), `src/lib/email.ts`
      (sendHouseholdInviteEmail), `src/lib/rate-limit.ts`,
      `src/lib/actions/household.ts` (createInviteAction, absoluteAppUrl,
      sendInviteEmailAction), `src/app/dashboard/profile/actions.ts`
      (updatePasswordAction — signOut+redirect pattern), `login-form.tsx`,
      `signup-form.tsx`, `join/[token]/page.tsx`, dictionaries (en/sv),
      `src/lib/actions/auth.test.ts`, `src/lib/actions/household.test.ts`.
- [x] 1. Prisma schema: added `PasswordResetToken` model near `Invitation`
      (`prisma/schema.prisma`). Ran
      `npx prisma migrate dev --name add_password_reset_token` against
      local Postgres (`household-hub-postgres-1`, already running) —
      migration `20260908063054_add_password_reset_token` created and
      applied. Ran `npx prisma generate`.
- [x] 2. `src/lib/actions/auth.ts`: added `requestPasswordResetAction` and
      `resetPasswordAction`, plus a local `absoluteAppUrl` helper
      (deliberately duplicated from household.ts, see comment there).
- [x] 3. `src/lib/email.ts`: added `sendPasswordResetEmail`.
- [x] 4. Pages: `src/app/forgot-password/page.tsx` +
      `src/components/auth/forgot-password-form.tsx`;
      `src/app/reset-password/[token]/page.tsx` +
      `src/components/auth/reset-password-form.tsx`; "Forgot password?"
      link added to `login-form.tsx`; `/login` shows a success message via
      `?reset=success`.
- [x] 5. Dictionaries: `auth.login.forgotPassword` /
      `auth.login.passwordResetSuccess` / `auth.forgotPassword.*` /
      `auth.resetPassword.*` added to both `en.ts` and `sv.ts`.
- [x] 6. Tests: extended `src/lib/actions/auth.test.ts` with 15 new tests
      (28 total in that file) covering both actions — valid request,
      unknown-email request (same generic response, no email sent), email
      send failure, token-creation failure, expired/used/unknown token,
      rate limiting for both actions.
- [x] 7. `npm run lint`, `npx next typegen` + `npx tsc --noEmit`,
      `npm run test` all clean. 358/358 tests pass (330 pre-existing + 28
      new/extended in auth.test.ts).
- [x] 8. Committed in 3 logical commits (migration; actions+email+tests;
      UI+dictionaries). No push, stayed off master.
- [x] 9. Final report delivered to the orchestrating session, including
      the flagged-but-not-fixed NextAuth JWT session-invalidation gap.

## Key decisions

- **Token expiry: 1 hour.** A reset link grants full account takeover to
  whoever holds it — a much higher-value target than a household invite
  (Invitation's 7-day expiry). An hour is generous for a legitimate user
  (reset emails typically arrive within seconds) while keeping a
  leaked/intercepted link's usable window small. See the doc comment on
  `PasswordResetToken` in `prisma/schema.prisma` and `RESET_TOKEN_TTL_MS`
  in `src/lib/actions/auth.ts`.
- **`absoluteAppUrl` duplicated into auth.ts** rather than exported from
  household.ts, to avoid adding a cross-file coupling between the two
  action modules ahead of Wave 2's sequential L/M tasks. Same precedent as
  `PASSWORD_MAX_LENGTH` already being duplicated between auth.ts and
  dashboard/profile/actions.ts.
- **Generic response for `requestPasswordResetAction`:** "If an account
  exists for that email, we've sent a password reset link." — returned
  identically whether or not the account exists, and regardless of
  whether the email actually sent. Only validation errors and rate
  limiting produce a distinct `{ error }` response (neither leaks account
  existence). This message is hardcoded English, matching this codebase's
  existing convention that action-returned messages (zod errors, "Too
  many attempts...", "An account with that email already exists", etc.)
  are not routed through the i18n dictionary — only UI chrome (labels,
  buttons, page titles) is.
- **Redirect-with-message:** no existing pattern in this codebase for
  redirect+flash-message, so used a `?reset=success` search param on
  `/login`, read via `PageProps<"/login">.searchParams` (same pattern as
  `dashboard/inventory/page.tsx`'s `?status=`).
- **No pre-render token validation on `/reset-password/[token]`** (unlike
  `/join/[token]`'s `getInvitationForDisplay`): `resetPasswordAction`
  already validates the token on submit and reports invalid/expired
  inline. Keeps the page simple; noted in that page's comment.
- Rate limits: `REQUEST_RESET_RATE_LIMIT` = 3 per hour per email (lower
  than signup's 5/hour — a legitimate user needs at most a couple of
  these per incident); `RESET_PASSWORD_RATE_LIMIT` = 10 per 10 min per
  token (matches `LOGIN_RATE_LIMIT`'s numbers, keyed per-token since the
  caller isn't yet known to be the token's rightful owner).

## Commits (in order)

1. `Add PasswordResetToken model and migration` — schema + migration only.
2. `Add requestPasswordResetAction and resetPasswordAction` — auth.ts,
   auth.test.ts, email.ts.
3. `Add forgot-password / reset-password pages and UI` — pages,
   components, login-form.tsx link, login/page.tsx success message,
   dictionaries.

## Follow-up flagged, not fixed (out of scope for this task)

NextAuth's JWT sessions aren't invalidated by a password change — an
attacker holding an already-issued session cookie stays logged in after
the legitimate owner resets their password via this flow (same gap
already exists for `updatePasswordAction`'s current-password-based
change, which only signs out the browser tab that submitted the change,
not other outstanding sessions/cookies elsewhere). Fixing this would need
either DB-backed sessions (a strategy change from NextAuth's current JWT
strategy) or a `passwordChangedAt`/session-version claim checked on every
request. Not addressed here per the task's explicit instructions.

## Note on this worktree's local setup

`.env` did not exist in this worktree (gitignored, not checked in) — it
was created by copying `.env.example` verbatim, which already points
`DATABASE_URL` at the same local Postgres the docker-compose file expects.
No other env vars were changed. If a fresh agent resumes here and finds no
`.env`, recreate it the same way before running any Prisma CLI commands.
