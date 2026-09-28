# AUTOPILOT.md

Control file for the autonomous improvement loop: scheduled Claude Code
sessions that find work (scouts), build it (builder), review and merge it
(reviewer), and improve the process itself (retro). Every autopilot session reads this file **first**
and obeys it. Edit it on `master` to steer or stop the loop; no routine
needs changing.

The skills that do the work are in `.claude/skills/autopilot-*/SKILL.md`.
The builder and reviewer run as a coordinator plus sub-agents: the
top-level session only picks the work, delegates one backlog item or one
PR to each sub-agent, tracks them, validates what they hand back and
reports. The builder builds every item it can within the limits below,
each in parallel in its own worktree; its heavy `npm run ci:local` runs
queue on a shared lock.
Routine prompts live in REQUIREMENTS.md, "Autonomous improvement loop".

## Switch

```yaml
enabled: true            # false = every autopilot session exits immediately
scouts_enabled: true
builder_enabled: true
reviewer_enabled: true
retro_enabled: true
```

## Limits

```yaml
max_open_autopilot_prs: 10     # builder does nothing while this many are open
max_new_items_per_scout_run: 3
max_parallel_subagents: 4      # builder/reviewer sub-agents running at once (4-CPU container)
max_merges_per_review_run: 3   # each merge re-runs ci:local on top of the new master
```

The builder's count per run is not a separate limit: it is as many
eligible, parallel-safe items as fit under `max_open_autopilot_prs` and
`max_parallel_subagents`, after the sub-agents fixing open PRs.

## What the builder may pick

Lowest phase first, then highest impact per effort (see BACKLOG.md's
"Picking an item"). Allowed prefixes, in priority order:

```yaml
allowed: [BUG, SEC, PERF, MAINT, UX, DEPS, AUTO, GAP, SCALE, BUDGET]
```

Never pick an item that is:
- marked `[!]` (needs a decision) or `[~]` (in progress), or sits under
  "Needs a decision before building";
- already the subject of an open PR (search open PRs for its ID);
- a Phase 2 (schema) item while another open PR adds a migration.

Items built in the same run must also be parallel-safe: at most one
Phase 2 and one Phase 3 item, and no two in the same feature area (see the
`autopilot-build` skill).

## Human-only areas

An autopilot PR touching any of these must say so in its Summary under
"⚠️ Needs careful review". The reviewer gives them a deeper pass (see the
`autopilot-review` skill) before merging:

- `prisma/schema.prisma`, `prisma/migrations/`
- `src/lib/auth.ts`, `src/lib/auth.config.ts`, `src/proxy.ts`, `src/lib/session.ts`
- anything computing money: `*budget*`, `*safe-to-spend*`, `*split*`,
  `*settlement*`, `*transaction*`
- deleting user data, `src/lib/cookie-inventory.ts`, the privacy page
- `.github/workflows/`, `AUTOPILOT.md`, `package.json` dependencies (except
  `DEPS-` items)

## CI gate

```yaml
ci_gate: local           # local | github
```

`local` (current): GitHub Actions is paused (`ci.yml` runs only on manual
dispatch) because the account can't start runners. The gate is
`npm run ci:local` (lint, typecheck, unit tests, build, e2e), run in the
session before every push. Paste its summary lines into the PR body under
"Verification". Ignore GitHub check runs entirely: a red or missing check
is not a failure to fix, comment on or wait for. The release workflow is
paused too, so a releasing PR cuts its own release before merge (see
AGENTS.md, "Pull requests and releases"). `github`: CI runs on
push/PR again and must be green, as in the `steward` skill.

## Merge policy

```yaml
auto_merge: reviewer     # false = a human merges every PR
never_merge_paths: [AUTOPILOT.md, .github/workflows/]
```

`reviewer`: the daily `autopilot-review` routine merges any open PR (any
author) it has reviewed as approved, with no open threads, after bringing
it up to date with `master` and passing `npm run ci:local`. Drafts and
PRs labelled `hold` are never merged. Nor is a PR touching
`never_merge_paths`: the loop doesn't loosen its own limits or CI, so a
human merges those. The builder never merges.

## Metrics

The retro appends one row per week. Autopilot "improving" means these move
the right way.

| Week | Merged | Reverted | Review rounds/PR | Unit tests | E2E tests | Lint warnings | Open backlog |
|---|---|---|---|---|---|---|---|
| 2026-09-27 | 3 | 0 | 0 | 2170 | 20 | 0 | 57 |
