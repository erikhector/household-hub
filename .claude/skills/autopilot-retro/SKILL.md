---
name: autopilot-retro
description: Weekly retrospective for household-hub's autonomous loop. Measures the week, finds recurring mistakes in autopilot PRs, and proposes small fixes to AGENTS.md, the skills or lint rules via one PR. Use when a routine says "run autopilot-retro".
---

# Autopilot retro

Improve the process, not the app. Output: one metrics row plus at most 3
process changes, in one `chore:` PR a human merges.

## 0. Gate

Read `AUTOPILOT.md`. Stop if `enabled` or `retro_enabled` is false.

## 1. Gather (last 7 days, minimal output)

- Merged and closed PRs labelled `autopilot`: title, whether reverted,
  number of review rounds (use minimal_output / list endpoints, not full
  bodies).
- Review comments and failed CI runs on those PRs: just the text of each
  comment and the failing step name.
- Counts: `npx vitest run --reporter=dot 2>&1 | tail -3` (unit tests),
  `grep -c "test(" e2e/*.ts` (e2e), `npm run lint 2>&1 | grep -c warning`,
  `grep -c '^- \[ \]' BACKLOG.md` (open items).

## 2. Diagnose

Group review comments and CI failures by cause. A cause seen **twice or
more** is a process gap. For each, pick the cheapest durable fix, in this
order of preference:
1. a lint rule or test that makes the mistake impossible;
2. a line in the `self-review` checklist;
3. a sentence in AGENTS.md (only if it applies to every change).

Also look for rules nobody needed: AGENTS.md or skill text that never came
up can be shortened. Keeping instructions short is part of the job.

If an autopilot PR was reverted, that's the top finding: say what the
builder's verification missed and close that gap first.

## 3. Ship

Append the metrics row to AUTOPILOT.md's table. Make at most 3 process
changes. Branch `autopilot/retro-<date>`, PR `chore: autopilot retro <date>`,
label `autopilot`. Body: the metrics, each finding with the PRs that show
it, and the change made. If the numbers justify loosening AUTOPILOT.md's
merge policy or limits, **propose** it in the body; never change those
settings yourself.
