---
name: steward
description: Repo-specific rules for driving a household-hub PR to green and mergeable — handling CI failures, review comments and merge conflicts. Use when watching or babysitting a PR in this repo.
---

# Steward (household-hub)

Repo conventions for getting a PR merged. General PR-driving rules from the
harness still apply; this file only adds what's specific to this repo.

## CI gate

Read `ci_gate` in AUTOPILOT.md first. While it is `local`, GitHub Actions
is paused (the account can't start runners) and GitHub check runs are
**not** a signal: don't fix, re-run, comment on or wait for them, and
don't treat "Release preview" failing as a blocker either. The gate is
`npm run ci:local` in your session: run it before every push and put its
summary in the PR body under "Verification". A PR is mergeable when that
passes, there's no conflict and no review thread waits on you. The
section below applies once `ci_gate` is `github` again.

## CI failures

CI has two jobs (`.github/workflows/ci.yml`): lint → typegen → tsc → test →
build, and a separate Playwright `e2e` job against a Postgres service.
Reproduce locally with the **same step only**, not the whole pipeline:

| Failing step | Reproduce with |
|---|---|
| Lint | `npx eslint <changed files>` |
| Typecheck | `npm run typecheck 2>&1 \| grep error \| head -n 30` |
| Test | `npx vitest run <failing file>` |
| Build | `npm run build 2>&1 \| tail -n 40` |
| End-to-end | `npm run build >/dev/null && npx playwright test <failing spec>`; the uploaded `playwright-report` artifact has traces |

Fetch only the failing job's log tail, not the full log. Fix, re-run that
step, then `npm run check` once before pushing. One validated push per round.

There's no database in CI; a test that needs one is wrong, so mock
`@/lib/prisma` like the existing tests.

## Merge conflicts

- Merge `origin/master` into the branch (never rebase a shared branch).
- `package-lock.json`: take master's, then `npm install` to regenerate.
- `package.json` `version` and `src/lib/release-notes/releases.json`: always
  take master's, since the release workflow owns them.
- `prisma/migrations/`: never edit an already-merged migration. If both sides
  added one, keep master's and regenerate yours on top with
  `npx prisma migrate dev --name <name>` (local DB only).
- BACKLOG.md / REQUIREMENTS.md: keep both sides' content.

## Review comments

Small, local asks (rename, extra test, i18n string, a one-function change):
implement and push. Anything touching the schema, tenancy model, auth or the
release flow is a design question: reply with a proposal and let the author
decide.

Reply in every thread you act on, naming the commit that fixes it (or why
you didn't). Don't resolve a `🤖 autopilot-review` thread yourself: the
`autopilot-review` routine checks the fix on its next run and resolves it.
A thread with your reply as its last comment counts as answered.

## Done means

CI green on the head commit, no conflicts, no unanswered review threads, PR
title is a Conventional Commit and the Release note section is filled in (or
empty on purpose for a non-releasing type).
