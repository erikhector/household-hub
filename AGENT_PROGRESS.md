# AGENT_PROGRESS.md — Household lifecycle follow-ups

Branch: `feature/household-lifecycle`

## Part A — ownership transfer / leaving a household

- [ ] `leaveHouseholdAction` in `src/lib/actions/household.ts`
- [ ] `transferOwnershipAction(newOwnerMemberId)` in `src/lib/actions/household.ts`
- [ ] Wire `userId` through to `MemberList` (page.tsx) so it can identify "my row"
- [ ] `member-list.tsx`: leave control on the caller's own non-owner row
- [ ] `member-list.tsx`: transfer-ownership control on owner view, per contributor row
- [ ] Confirm dialogs for leave + transfer (inline in member-list.tsx, no new files)

## Part B — email delivery for invites

- [ ] Pick email provider (checked codebase first — no existing preference found)
- [ ] `src/lib/email.ts` — `sendHouseholdInviteEmail()`
- [ ] `sendInviteEmailAction(token, email)` in `src/lib/actions/household.ts`
- [ ] `createInviteAction` returns `token` alongside `url` (unchanged behavior otherwise)
- [ ] `invite-button.tsx`: email input + send button, keep link/copy UX as-is
- [ ] `.env.example` — new env var(s) documented

## Shared / cross-cutting

- [ ] i18n keys added to `en.ts` and `sv.ts` (real Swedish translations, not copies)
- [ ] REQUIREMENTS.md — new subsection, remove corresponding "Not yet built" line(s)
- [ ] `npx tsc --noEmit -p tsconfig.json` — zero errors
- [ ] `npx eslint src` — zero errors/warnings
- [ ] `npm run build` — succeeds
- [ ] Final commit with this file fully checked off

## Decisions / notes

- Worktree had no `node_modules` — ran `npm install` first.
- Error strings returned from actions (e.g. "Member not found") follow the
  existing codebase convention of staying hardcoded English (see
  `removeMemberAction`, `createHouseholdSchema`, etc.) — not routed through
  the dictionary. Only UI copy (button labels, dialog text) goes through
  `dict`.
- Email provider: TBD — see below once chosen.
