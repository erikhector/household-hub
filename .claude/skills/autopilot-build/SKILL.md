---
name: autopilot-build
description: Autonomous builder for household-hub. Picks one eligible BACKLOG.md item, implements it end to end (code, unit + e2e tests, docs), opens a PR and drives it to green. Use when a routine says "run autopilot-build".
---

# Autopilot builder

One item, done properly, per run. Quality bar is the same as for a human
PR; the difference is nobody is watching, so verify everything.

## 0. Gate

1. Read `AUTOPILOT.md`. Stop if `enabled` or `builder_enabled` is false.
2. Count open PRs with `is:open label:autopilot NOT backlog in:title NOT
   retro in:title` (a GitHub search, not eyeballing the label list) — this
   is builder-opened PRs only, never scout scans (titled
   `docs(backlog): …`) or retro PRs (titled `chore: autopilot retro …`).
   `-in:title "docs(backlog)"` looks like a negation but isn't one GitHub
   search honours, so it silently over-counted (confirmed live
   2026-09-28: identical results with and without it). A scout or retro PR
   is still labelled `autopilot`, so counting the label alone over-counts
   too and can wrongly stop the builder (seen 2026-09-27: 3 open scout PRs
   alone hit the old cap of 2, forcing a manual limit bump in #89 instead
   of a real fix). If the search count is ≥ `max_open_autopilot_prs`, stop:
   finishing beats starting.
3. If an open `autopilot` PR has unanswered review comments, a merge
   conflict, or (only when AUTOPILOT.md says `ci_gate: github`) red CI,
   work on **that** instead, per the `steward` skill, and stop after.

## 1. Pick

List candidates in one call:
`grep -n '^- \[ \] \*\*[A-Z]\+-[0-9A-Z]\+\.' BACKLOG.md`.
Apply AUTOPILOT.md's allowed prefixes and exclusions, lowest phase first,
then best impact/effort. Confirm no open PR mentions the ID. Read only that
item's text and the REQUIREMENTS.md section it touches.

If the item turns out to be ambiguous or bigger than one PR, don't guess:
open a `docs(backlog)` PR that splits it or marks it `[!]` with the
question, and stop.

## 2. Build

Follow AGENTS.md's Development workflow exactly (orient → implement → test
→ verify → self-review → document), plus:

- **Tests**: unit tests for logic (`*.test.ts`). For any user-visible
  change, add or extend a spec in `e2e/` that asserts the item's
  Acceptance line through the UI, following AGENTS.md "UI tests". It
  runs on the `desktop` and `mobile` projects, so it must pass on both;
  a new page goes in `e2e/routes.ts`. For a `UX-` item, compare
  `npm run test:e2e:screenshots` before and after. A bug fix gets a test
  that fails first.
- **Verify**: `npm run ci:local` (lint, typecheck, unit tests, build,
  e2e). All green, no skipped tests. While AUTOPILOT.md says
  `ci_gate: local` this *is* CI: re-run it before every push and ignore
  GitHub check runs.
- **Self-review**: run the `self-review` skill, then re-read the diff once
  more asking "what would a careful reviewer reject?". Fix it.

## 3. Ship

- Branch `autopilot/<id-lowercase>-<slug>`.
- PR title: Conventional Commit ending in the ID, e.g.
  `fix: stop the budget chart overflowing on phones (UX-4)`.
- Body: fill in the PR template. Release note in English **and** Swedish,
  written for users. If AUTOPILOT.md's human-only areas are touched, add
  "⚠️ Needs careful review" listing them.
- Body also gets a "Verification" section with the summary lines of
  `npm run ci:local` (test counts, pass/fail) for the pushed commit.
- Label `autopilot`. Subscribe to the PR and drive it to mergeable with the
  `steward` skill (review comments, conflicts, and CI per `ci_gate`).
  Never merge it yourself: the `autopilot-review` routine reviews and
  merges every PR.

## 4. Report

Final message: item ID, PR link, what was tested. Nothing else.
