---
name: steward
description: Repo-specific rules for driving a household-hub PR to green and mergeable — handling CI failures, review comments and merge conflicts. Use when watching or babysitting a PR in this repo.
---

# Steward (household-hub)

Repo conventions for getting a PR merged. General PR-driving rules from the
harness still apply; this file only adds what's specific to this repo.

## CI failures

CI is one job: lint → typegen → tsc → test → build (`.github/workflows/ci.yml`).
Reproduce locally with the **same step only**, not the whole pipeline:

| Failing step | Reproduce with |
|---|---|
| Lint | `npx eslint <changed files>` |
| Typecheck | `npm run typecheck 2>&1 \| grep error \| head -n 30` |
| Test | `npx vitest run <failing file>` |
| Build | `npm run build 2>&1 \| tail -n 40` |

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

## Done means

CI green on the head commit, no conflicts, no unanswered review threads, PR
title is a Conventional Commit and the Release note section is filled in (or
empty on purpose for a non-releasing type).
