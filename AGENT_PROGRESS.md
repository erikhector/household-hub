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
- [ ] Design email-change security flow
- [ ] Design avatar approach (decided: deterministic initials-based avatar,
      no upload, no schema change — see notes below)
- [ ] Email change action + form
- [ ] Password change action + form
- [ ] Avatar component implemented
- [ ] Schema migration — NOT NEEDED (see decision notes)
- [ ] i18n keys en + sv (profile namespace restructured)
- [ ] REQUIREMENTS.md subsection
- [ ] tsc/eslint/build pass
- [ ] final commit

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
