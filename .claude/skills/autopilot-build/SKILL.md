---
name: autopilot-build
description: Autonomous builder for household-hub. The top-level session picks every BACKLOG.md item that can be built in parallel within AUTOPILOT.md's limits, delegates each to a sub-agent that implements it end to end (code, unit + e2e tests, docs) and opens a PR, then validates each PR and drives them to green. Use when a routine says "run autopilot-build".
---

# Autopilot builder

As many items as the limits allow per run, each done properly by its own
sub-agent. Quality bar is the same as for a human PR; the difference is
nobody is watching, so verify everything.

**Two roles.** The session the routine starts is the **coordinator**. It
never writes app code. It gates, picks the items, starts one sub-agent per
item or PR (the `Agent` tool, `general-purpose`, `isolation: "worktree"`,
in the background), keeps track of them, validates what each one hands
back, and reports. Each **sub-agent** builds exactly one item (or fixes
exactly one PR) in its own git worktree and opens or updates that one PR.
Keeping the coordinator out of the code keeps its context small enough to
track several PRs, and gives every PR a second check by someone who didn't
write it.

## 0. Gate (coordinator)

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
   of a real fix). `headroom = max_open_autopilot_prs − count`.
3. List the open `autopilot` PRs that need work: unanswered review
   comments, a merge conflict, or (only when AUTOPILOT.md says
   `ci_gate: github`) red CI. Finishing beats starting, so each of these
   gets a **fix sub-agent** (step 2) before any new item gets a builder.
   Fixing doesn't open a PR, so it doesn't use headroom, only
   `max_parallel_subagents` slots.
4. `slots = max_parallel_subagents − fix sub-agents`. New builds this run
   `= min(headroom, slots, parallel-safe eligible items)` (step 1). If
   that's 0 and there's nothing to fix, report and stop.

## 1. Pick (coordinator)

List candidates in one call:
`grep -n '^- \[ \] \*\*[A-Z]\+-[0-9A-Z]\+\.' BACKLOG.md`.
Apply AUTOPILOT.md's allowed prefixes and exclusions. **Every eligible
`UX-` item comes first** (best impact/effort among them), then the
eligible IDs in PRODUCT.md's "Focus" list in its order; only the slots
left after those go to other items, lowest phase first, then best
impact/effort. Confirm no open PR mentions each ID. Read only the
chosen items' text, not the REQUIREMENTS.md sections: that's the
sub-agent's job.

The set built in one run must be **parallel-safe**, so the PRs don't
fight each other at merge time:

- at most one Phase 2 (migration) item, and none while an open PR adds a
  migration;
- at most one Phase 3 (large) item;
- no two items in the same feature area (the same
  `src/app/dashboard/<feature>/`, `src/components/<feature>/` or `src/lib`
  calculator, judged from the item text). Shared append-only files
  (`en.ts`/`sv.ts`, `e2e/routes.ts`, REQUIREMENTS.md, BACKLOG.md) don't
  count: the reviewer merges those conflicts mechanically.

Stop adding items when the next one would break a rule; take the next
eligible one instead, up to the count from step 0.

## 2. Delegate (coordinator)

Start all sub-agents in **one** message so they run in parallel, each with
`isolation: "worktree"` and `run_in_background: true`, and track them in
a list (item or PR, agent id, status). Sub-agents start cold, so each
prompt must stand alone: the item ID and its full BACKLOG.md text (or the
PR number and what needs fixing), the branch name
`autopilot/<id-lowercase>-<slug>`, and an instruction to read and follow
`## Sub-agent: build one item` (or `## Sub-agent: fix one PR`) of
`.claude/skills/autopilot-build/SKILL.md` exactly and return its report
format. Don't paste the procedure into the prompt; the file is the
procedure.

While they run, don't poll and don't do their work. Each one's report
arrives as a notification; validate it (step 3) as it comes in.

The coordinator is the human proxy: it answers any question a sub-agent has; sub-agents never block on a human. Reversible work proceeds with the result reported; irreversible writes pause for the coordinator's explicit call.

## 3. Validate (coordinator)

A sub-agent's report is a claim. Check each one against what's really on
GitHub and on disk before accepting it:

1. **The PR exists**, on the stated branch, its head SHA matches the SHA
   the sub-agent reports, and the worktree is clean at that SHA
   (`git -C <worktree> status --short` empty, `rev-parse HEAD` equal).
2. **The gate ran on that SHA.** `$(git -C <worktree> rev-parse
   --git-dir)/ci-local.log` starts with that SHA and its tail shows lint,
   typecheck, unit tests, build and e2e all passing with nothing skipped
   (`tail -n 30`, `grep -E 'skipped|failed|✘'`). The PR's Verification
   section matches it.
3. **The PR is well-formed**: Conventional Commit title ending in the
   item ID, label `autopilot`, template filled in, release note in English
   and Swedish for a releasing type, and "⚠️ Needs careful review" if the
   diff touches a human-only area (check `git diff --stat
   origin/master...<branch>` against AUTOPILOT.md's list yourself).
4. **The diff is in scope**: `--stat` shows only files the item plausibly
   needs, the BACKLOG.md item is deleted and REQUIREMENTS.md is updated,
   new logic has a colocated `*.test.ts`, and a user-visible change has an
   `e2e/` spec. Don't re-review the code line by line: the
   `autopilot-review` routine does that.

Any check fails: send the specific failure back to that sub-agent with
`SendMessage` (its context is intact) and validate again when it
answers. After a second failed round, convert the PR to a draft, comment
what's wrong on it (ending with the attribution footer), and mark it
failed in your list. Never fix it yourself.

A validated PR: subscribe to its activity (`subscribe_pr_activity`). PR
events wake the coordinator, not the sub-agent: hand each actionable one
(per the `steward` skill) to the PR's sub-agent with `SendMessage`, or to
a new fix sub-agent if that one is gone, then validate again. Never merge:
the `autopilot-review` routine reviews and merges every PR.

## 4. Report (coordinator)

Final message, one line per item or PR: ID, PR link, status (validated /
fixed / draft: why), what was tested. Then the run's totals (built,
fixed, failed, headroom left). Nothing else.

---

## Sub-agent: build one item

You build the one item in your prompt, in your own worktree, and open its
PR. Other sub-agents are building other items in parallel in their own
worktrees. The coordinator validates your report, so report facts.

### Set up the worktree

The worktree is a fresh checkout with no `node_modules`, no `.env` and
nothing built, and other worktrees share this machine's CPU and Postgres:

1. `git checkout -b <branch from your prompt> origin/master`.
2. `npm ci --prefer-offline --no-audit --no-fund --loglevel=error`.
3. Your own database, so parallel e2e runs and migrations don't collide:
   `psql postgresql://household:household@localhost:5432/postgres -c
   'CREATE DATABASE household_hub_<id-lowercase-with-underscores>'`, then
   write `.env` with `DATABASE_URL` pointing at it and `AUTH_SECRET` from
   `.env.example`, then `npx prisma migrate deploy`.
4. Never start a server yourself. Playwright starts `next start` on port
   3000 and reuses any server already there, so it must only run under
   the lock below.

### Build

Follow AGENTS.md's Development workflow exactly (orient → implement → test
→ verify → self-review → document), plus:

Match a `poteto-mode` playbook first (`feature` for behavior, `bug-fix` for defects, `refactoring` for structure-only), then follow it through this file's own orient/implement/test/verify gate. Call pstack skills explicitly by ID; do not pre-read uncalled playbooks or principles.

- **Orient**: read the item's REQUIREMENTS.md section (grep headings,
  then read the range). If the item turns out to be ambiguous or bigger
  than one PR, don't guess: open a `docs(backlog)` PR that splits it or
  marks it `[!]` with the question, and report that instead.
- **Tests**: unit tests for logic (`*.test.ts`). For any user-visible
  change, add or extend a spec in `e2e/` that asserts the item's
  Acceptance line through the UI, following AGENTS.md "UI tests". It
  runs on the `desktop` and `mobile` projects, so it must pass on both;
  a new page goes in `e2e/routes.ts`. Any UI change follows DESIGN.md
  and passes its "UI review checklist", including the hard Mobile UX
  rules (M1–M10) for the component or page it touches, existing parts
  included. For a `UX-` item, compare
  `npm run test:e2e:screenshots` before and after (under the lock). A bug
  fix gets a test that fails first.
- **Verify**: focused `npx vitest run <path>` while iterating. The full
  gate builds and serves the app, which the machine can only do one at a
  time, so always run it under the shared lock and keep its log where the
  coordinator will look:

  ```bash
  LOG="$(git rev-parse --git-dir)/ci-local.log"
  { git rev-parse HEAD; flock "$(git rev-parse --git-common-dir)/ci-local.lock" npm run ci:local; } > "$LOG" 2>&1; echo "exit $?"; tail -n 30 "$LOG"
  ```

  Run it on the exact commit you push (commit first), and again after
  every later commit. All green, no skipped tests. It's the pre-push
  check: with `ci_gate: github` the PR's GitHub CI must also go green,
  and the coordinator's fix sub-agents handle it if it doesn't.
- **Self-review**: run the `self-review` skill, then re-read the diff once
  more asking "what would a careful reviewer reject?". Fix it.

### Ship

- PR title: Conventional Commit ending in the ID, e.g.
  `fix: stop the budget chart overflowing on phones (UX-4)`.
- Body: fill in the PR template. Release note in English **and** Swedish,
  written for users. If AUTOPILOT.md's human-only areas are touched, add
  "⚠️ Needs careful review" listing them.
- Body also gets a "Verification" section with the summary lines of
  `npm run ci:local` (test counts, pass/fail) for the pushed commit.
- Label `autopilot`. Don't subscribe to the PR and don't merge it: the
  coordinator subscribes and routes review comments back to you.

### Report

Return exactly: item ID, PR URL, branch, pushed head SHA, worktree path,
the `ci:local` summary lines, the human-only areas touched (or none), and
anything you couldn't do. Nothing else.

## Sub-agent: fix one PR

You bring one existing `autopilot` PR to mergeable: check out its branch
in your worktree (never a new branch), set the worktree up as above, and
work its open review comments, merge conflict or (only with
`ci_gate: github`) red CI per the `steward` skill. Verify with the same
locked `ci:local` command before every push. Report as above: PR URL,
branch, pushed head SHA, worktree path, `ci:local` summary, and one line
per thread or problem saying how it was settled.

Match a `poteto-mode` playbook first (`bug-fix` for defects, `refactoring` for structure-only), then follow it through this file's verify gate. Call pstack skills explicitly by ID; do not pre-read uncalled playbooks or principles.
