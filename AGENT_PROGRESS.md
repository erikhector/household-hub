# AGENT_PROGRESS.md — Household lifecycle follow-ups

Branch: `feature/household-lifecycle`

## Part A — ownership transfer / leaving a household

- [x] `leaveHouseholdAction` in `src/lib/actions/household.ts`
- [x] `transferOwnershipAction(newOwnerMemberId)` in `src/lib/actions/household.ts`
- [x] Wire `userId` through to `MemberList` (page.tsx) so it can identify "my row"
- [x] `member-list.tsx`: leave control on the caller's own non-owner row
- [x] `member-list.tsx`: transfer-ownership control on owner view, per contributor row
- [x] Confirm dialogs for leave + transfer (inline in member-list.tsx, no new files)

## Part B — email delivery for invites

- [x] Pick email provider (checked codebase first — no existing preference found) → Resend
- [x] `src/lib/email.ts` — `sendHouseholdInviteEmail()`
- [x] `sendInviteEmailAction(token, email)` in `src/lib/actions/household.ts`
- [x] `createInviteAction` returns `token` alongside `url` (unchanged behavior otherwise)
- [x] `invite-button.tsx`: email input + send button, keep link/copy UX as-is
- [x] `.env.example` — new env var(s) documented

## Shared / cross-cutting

- [ ] i18n keys added to `en.ts` and `sv.ts` (real Swedish translations, not copies)
- [ ] REQUIREMENTS.md — new subsection, remove corresponding "Not yet built" line(s)
- [ ] `npx tsc --noEmit -p tsconfig.json` — zero errors
- [ ] `npx eslint src` — zero errors/warnings
- [ ] `npm run build` — succeeds
- [ ] Final commit with this file fully checked off

## Decisions / notes

- Worktree had no `node_modules` — ran `npm install` first (dependency
  count matched the root repo's install).
- Error strings returned from actions (e.g. "Member not found") follow the
  existing codebase convention of staying hardcoded English (see
  `removeMemberAction`, `createHouseholdSchema`, etc.) — not routed through
  the dictionary. Only UI copy (button labels, dialog text) goes through
  `dict`.
- Email provider: **Resend**. No existing provider/preference found anywhere
  in the codebase (checked `package.json`, grepped for resend/nodemailer/
  sendgrid/email — nothing). Resend matches AGENT_TASKS.md's own suggestion
  and needs only an API key (`resend.dev`'s shared sending domain works
  without domain verification, good for local/dev). `npm install resend` run.
- `sendInviteEmailAction(token, email)` is a *new* action alongside the
  unchanged `createInviteAction` (which now also returns `token`) rather
  than folding email into invite creation — keeps the always-shown
  on-screen link (existing UX) fully independent of whether/when an email
  send is attempted, and reuses the *same* invitation/token for both.
- The join-link's absolute URL for the email body is built server-side from
  request headers (`x-forwarded-host`/`host`, `x-forwarded-proto`) rather
  than trusting a client-supplied origin, since a Server Action is an
  untrusted POST entry point (see `node_modules/next/dist/docs/01-app/
  02-guides/server-actions.md`'s "Security" section) and the URL goes into
  an email sent on the household's behalf.
- **Flagged deviation from "primary files only"**: `.gitignore` blanket-
  ignores `.env*`, which also swallows `.env.example` (confirmed via
  `git check-ignore -v`). Since `.env.example` didn't exist in the repo at
  all yet README already instructs `cp .env.example .env`, and the
  `.gitignore` comment literally says "can opt-in for committing if
  needed", added a one-line `!.env.example` negation. This is the minimum
  change needed for the Definition-of-Done's ".env.example documents the
  var" requirement to actually land in git; low conflict risk since no
  other Wave-1 task's primary/shared files include `.gitignore`.
