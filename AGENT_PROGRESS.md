# Profile enhancements — progress

Task: extend `/dashboard/profile` with email change, password change, and
avatar support. See `AGENT_TASKS.md` "3. Profile enhancements".

## Checklist

- [x] Read AGENTS.md, REQUIREMENTS.md, AGENT_TASKS.md (ground rules +
      coordination mechanics + task 3 details)
- [x] Set up worktree environment: copied `.env`/`.env.example` from repo
      root (not committed — gitignored), confirmed shared Postgres
      (`docker compose ps`) already running, `npm install` (node_modules
      didn't exist yet in this worktree), `npx prisma migrate status`
      (schema was already up to date, no pending migrations)
- [x] Design email-change security flow (current-password re-verification)
- [x] Design avatar approach (deterministic initials-based avatar, no
      upload, no schema change — see notes below)
- [x] Email change action + form (`updateEmailAction`, `email-form.tsx`)
- [x] Password change action + form (`updatePasswordAction`,
      `password-form.tsx`)
- [x] Avatar component implemented (`avatar.tsx`, `UserAvatar`)
- [x] Schema migration — NOT NEEDED (see decision notes; confirmed via
      `npx prisma migrate status` before and after — no new migration
      required or added)
- [x] i18n keys en + sv (profile namespace restructured into
      `avatar`/`displayNameForm`/`emailForm`/`passwordForm`)
- [x] REQUIREMENTS.md subsection (expanded "User profile" under "Data
      model"; removed the corresponding "Not yet built" line)
- [x] tsc/eslint/build pass (all three clean as of the final commit)
- [x] Browser-verified end-to-end (see notes below) — found and fixed one
      real bug in the process
- [x] final commit

## Decisions

- **Avatar approach**: deterministic, initials-based avatar computed purely
  from `displayName` (initials) and `userId` (hashed to pick one of the
  existing `--chart-1..5` tokens for background color). No file upload, no
  new `User.avatarUrl` column, no migration. Rationale: the task explicitly
  offers this as the "keep it simple" option when real file storage is out
  of scope, and this codebase has zero existing file/blob storage
  integration (no S3/Vercel Blob/Cloudinary env vars or deps) — building
  real upload would mean adding new infrastructure/dependencies, which is
  scope creep for this pass and also risky on typical serverless deploy
  targets where local filesystem writes don't persist. A purely computed
  avatar needs nothing persisted, so it also avoids the coordination risk
  around the shared dev Postgres migration entirely.
- **Email change security**: require re-entering the current password
  (verified via `bcrypt.compare` against `user.passwordHash`, the same
  hashing already used in `src/lib/actions/auth.ts`) before an email change
  takes effect. No email-based re-verification link, because this app has
  no email delivery integration yet anywhere (invites are copy/paste links
  per REQUIREMENTS.md) — that's Task 5's job in a separate worktree, not
  this task's to build. Current-password confirmation is the documented
  minimum bar in the task description and is a real, meaningful gate against
  the realistic threat here (a hijacked/left-open session), even without
  email verification.
- **Password change security**: current password + new password + confirm,
  hashed with `bcrypt.hash(newPassword, 12)` (same cost factor as signup).
  After a successful change, the current session is signed out
  (`signOut({ redirectTo: "/login" })`) forcing re-authentication with the
  new password — standard practice when a credential is rotated, and cheap
  to do here since `logoutAction` already establishes the pattern.

## Verification notes

- Ran `npx tsc --noEmit`, `npx eslint src`, and `npm run build` clean at the
  end (also mid-way, right after first landing the feature).
- `npx prisma migrate status` confirmed "Database schema is up to date"
  both before starting and at the end — no migration was needed or added.
- Manually exercised the feature end-to-end against the shared dev Postgres
  via a real signup + browser session (`next start` on a scratch port,
  since `next dev` refuses to run a second instance system-wide — another
  session already had one running against the main repo checkout):
  - Display name change: saves, "Saved" message shows, avatar initials
    update immediately (e.g. "Test Agent" → "TA", renamed to "Renamed
    Agent" → "RA").
  - Email change: wrong current password → "Current password is
    incorrect", correct password → DB updates (checked directly via
    `psql`), success message shows.
  - **Found and fixed a real bug** during this testing: the disabled
    "Current email" field used `defaultValue={email}` with no `key`, so
    after a successful change the uncontrolled input kept showing the
    pre-change email until a hard reload (React doesn't re-apply
    `defaultValue` to an already-mounted uncontrolled input). Fixed by
    adding `key={email}` to that Input and the inner `<form>`, mirroring
    the `key={displayName}` pattern `DisplayNameForm` already used for the
    exact same reason. Re-verified after the fix (and after a fresh
    `npm run build`) that the field now updates in place immediately after
    a successful submit — separate commit, see git log.
  - Password change: wrong current password → rejected; new/confirm
    mismatch → "Passwords do not match"; correct flow → password updates,
    session is signed out, redirected to `/login`, and logging back in
    with the *new* password succeeds.
  - Note: this test browser environment has a pre-existing React hydration
    warning (minified error #418) that reproduces even on pages this task
    didn't touch (e.g. `/dashboard/household`) — an environment/pre-existing
    quirk, not something introduced here. It made raw synthetic mouse
    clicks unreliable for triggering React's form submit handler in this
    harness, so the flows above were driven via native input events +
    `form.requestSubmit()` (a legitimate, standards-based way to trigger
    the exact same React form-action code path) rather than being masked
    or ignored.

## Final state

Branch `feature/profile-enhancements`, all Definition-of-Done checks green,
everything committed (see git log on this branch).
