# pstack into the autonomous loop — design

Date: 2026-10-10
Status: draft for builder-check, not yet approved for build

## Intent and why

Install a trimmed, pinned slice of `backnotprop/pstack` (plain Agent Skills)
into household-hub and wire it tight into the autonomous loop, so builder
and reviewer sub-agents make better decisions with the same coordinator
structure.

The loop today is five scheduled routines steered by `AUTOPILOT.md`, with
procedure in `.claude/skills/autopilot-*/SKILL.md`. The builder coordinator
never writes code. One worktree sub-agent builds one backlog item and opens
one PR. The reviewer does comment reviews and mechanical merges. Quality
drifts by model and by run, and fixable calls bounce to review rounds.

pstack's entry point is `poteto-mode`, a router that matches the task to a
playbook (`feature`, `bug-fix`, `refactoring`, `babysit`, `shipping`,
`opening-a-pr`, and others) and routes to situational skills (`how`, `why`,
`architect`, `interrogate`, `tdd`, `unslop`, `technical-writing`,
`no-comments`) plus short principle files. The human partner's words for
success: better decisions in the worktree, fewer review rounds per PR,
more consistency across runs, with speed, quality, and token cost balanced
for most bang for the buck.

## Goals

- Builder sub-agents follow a named pstack playbook path for the common
  cases (new/changed behavior via Feature, reported defect via Bug fix,
  behavior-preserving change via Refactoring) instead of improvising
  structure.
- Orientation uses `how`/`why`/`architect` before committing to a shape,
  so placement and layering calls match what the reviewer would ask for.
- Tests follow `tdd` behavior style on top of the repo's existing
  colocated `*.test.ts` + `e2e/` rules. No change to what must be tested,
  only to how decisions get made while testing.
- Reviewer sub-agents apply the deeper human-only pass plus `no-comments`
  hygiene before posting, so findings are blocking-or-question, file:line,
  with a concrete fix, most severe first.
- Prose surfaces (replies, PR bodies, review comments) follow `unslop` +
  `technical-writing` so coordinator reports, PR templates, and review
  threads stay consistent.
- Token cost is a first-class goal. Extra skill reads must pay for
  themselves through saved review rounds and fewer fix pushes.
- The loop runs without human intervention. The builder coordinator acts
  as the human proxy: it answers any product or preference question a
  builder, fix, review, or merge agent has, and agents never block
  waiting on a human. Reversible work proceeds with the result reported
  for course-correction. Irreversible writes (force-push to shared
  branches, deploys, data deletion, customer messages) still pause for
  the coordinator's explicit call.

## Non-goals

- No change to coordinator structure, parallel-safe rules, merge policy,
  CI gate, or AUTOPILOT.md limits in this item.
- No adoption of pstack's default model panel (upstream defaults point at
  models this repo does not use). No new paid service, account, or key.
- No full 50-skill vendor. No `arena`/`swarm` fan-out, no `automate-me` /
  `teach` / `poteto-help` / `setup-pstack` meta skills, no `make-bot-ui`,
  no benny Slack automation pack, no `benchmark-checklist` unless a later
  perf item wants it.
- No change to product direction, BACKLOG.md priorities, or focus list.
- No new app code, schema change, or UI change. This item ships skills +
  prompt wiring + docs only.

## Anti-goals

- A technically installed pstack that increases review rounds per PR or
  increases revert rate is a failure, even if every file is in place.
- A wiring that blows up context on every run (full principle index,
  multi-model bakeoffs on every item) is a failure, even if decisions
  improve on one PR.
- A wiring that routes autonomous work onto paid models or new third
  parties without a human decision is a failure.
- A loop that loosens its own limits or CI through this change is a
  failure.

## Constraints

- `AUTOPILOT.md` product rules still hold. The product routine cannot
  decide this item. A human merges anything under `never_merge_paths`.
  This design does not touch `AUTOPILOT.md` limits or `.github/workflows/`.
- Coordinator never writes app code and never fixes a sub-agent's PR
  itself. That separation stays.
- Parallel-safe and per-run limits are unchanged. pstack skills must not
  add their own background fan-out that fights `max_parallel_subagents`
  or the shared `ci-local` lock.
- `AGENTS.md` working rules apply to the build PR itself: small diff,
  feature branch, focused tests while iterating, full `npm run check`
  plus build before push, self-review skill before opening the PR,
  REQUIREMENTS.md updated for shipped behavior.
- Skill frontmatter must stay in the `name` + `description` shape the
  harnesses trigger on. Do not rename upstream skill names. Thin local
  wrappers, if needed, get their own names.
- Browser storage, i18n dictionaries, and app conventions are out of
  scope unless the builder finds a string the wiring itself shows to
  users, which is not expected.
- Upstream is a moving mirror. The build PR pins one upstream commit SHA
  and records it plus the selected file list in the PR body and in
  REQUIREMENTS.md, so a later DEPS-style item can bump it.

## The parts decided so far

- **Slice (bang for buck).** Vendor: `poteto-mode` (router + playbooks
  `feature`, `bug-fix`, `refactoring`, `babysit`, `shipping`,
  `opening-a-pr`), `how`, `why`, `architect`, `interrogate`, `tdd`,
  `unslop`, `technical-writing`, `no-comments`, `reflect`, plus this
  principle subset: `principle-laziness-protocol`,
  `principle-foundational-thinking`, `principle-model-the-domain`,
  `principle-boundary-discipline`, `principle-type-system-discipline`,
  `principle-prove-it-works`, `principle-fix-root-causes`,
  `principle-sequence-verifiable-units`,
  `principle-test-behavior-not-implementation`,
  `principle-guard-the-context-window`. Everything else stays out. The
  builder confirms each file exists at the pinned SHA and drops any that
  moved or renamed upstream, listing the drop in the PR.
- **Install location.** Canonical copy under `.agents/skills/` for
  OpenCode, mirrored under `.claude/skills/` for the Claude Code
  scheduled sessions, from the same pinned SHA. If the builder finds the
  harness loads one location for both, prefer the single copy and
  document why. No `npx skills add` at runtime in the loop. The pin is
  the source of truth.
- **Model mapping.** Ship a repo-local mapping that sets every role to
  `inherit-parent` (run on the scheduled session's model). Do not write
  user-level `~/.agents/pstack-models.md` from the loop and do not pin
  paid model slugs. A human can override locally later.
- **Wiring points, tight.** In `autopilot-build` SKILL.md, the coordinator
  `Delegate` section names the coordinator as the human proxy that answers
  sub-agent questions (agents never block on a human; reversible work
  proceeds and reports, irreversible writes pause for the coordinator).
  Both `Sub-agent: build one item` and `Sub-agent: fix one PR` name the
  required pstack entry: match to a `poteto-mode` playbook first, then
  follow its steps through the repo's own orient/implement/test/verify
  gate. In `autopilot-review` SKILL.md, `Sub-agent: review one PR` names
  the required pre-post pass (`no-comments` hygiene, human-only deeper
  read where AUTOPILOT.md says so). Wording stays one or two lines per
  site plus a pointer to the vendored file, not a paste of the upstream
  procedure, so updates stay cheap.
- **What stays verbatim.** The repo's verification gate (`npm run check`,
  build, `e2e` where user-visible, locked `ci:local` under parallel
  runs), PR template + bilingual release note rules, and tenancy/security
  checks do not move into pstack files. pstack informs judgment inside
  those gates.
- **Metrics.** Success is visible in the retro table: review rounds per
  PR down or flat with fewer fix pushes, no rise in reverts, no rise in
  lint warnings. The build PR itself does not need to move those numbers.
  It only needs to make the wiring available without breaking the loop.
- **Docs.** Update `AGENTS.md` Autonomous loop section and the two
  touched autopilot skills. Update REQUIREMENTS.md shipped behavior
  (Autonomous improvement loop) with the vendored slice + pin + wiring
  points. No BACKLOG.md item is consumed unless the human partner names
  one. No version bump by hand.

## Builder check (2026-10-10) — calls made

Fresh-builder review asked six questions. Disposition:

- **Upstream source, layout, license (answered by recon, not a guess).**
  Source is `https://github.com/backnotprop/pstack`, branch `main`,
  layout `skills/<name>/SKILL.md` plus `skills/poteto-mode/playbooks/*.md`
  and principle files under `skills/principle-*/SKILL.md`. README states
  MIT license. Vendoring a pinned slice with attribution is the intended
  use (the mirror exists for standalone use outside Cursor).
- **Repo-local model mapping (our call).** Ship
  `.agents/pstack-models.md` in-repo with every role set to
  `inherit-parent`, and point the Claude Code sessions at the same file
  via a one-line note in each touched autopilot skill. Verify by grepping
  the vendored router text for its settings-file lookup and confirming
  the file path it reads resolves to the shipped file. No user-level
  `~/.agents/pstack-models.md` writes from the loop.
- **Invocation mechanism and lazy-load (our call).** Both harnesses trigger
  on skill `description` match plus explicit call. Autopilot wiring uses
  explicit call only: name the exact skill ID in the sub-agent prompt and
  forbid pre-reading unneeded playbooks or principles. The pointer line is
  the token control.
- **Unwired slice members (our call).** Vendor the full slice above but
  tight-wire only `feature` / `bug-fix` / `refactoring` in the builder and
  the `no-comments` pre-post pass in the reviewer. `interrogate` is
  opt-in for contested design, `reflect` opt-in for second opinion,
  `babysit` / `shipping` / `opening-a-pr` are referenced only at ship
  time. Unreferenced files stay discoverable, not required, so they cost
  nothing unless called.
- **Loop-safety proof (our call).** Static gate only: `npm run check`,
  build, frontmatter parse of every vendored `SKILL.md`, and existence
  check of every referenced playbook path. No live scheduled run, no
  worktree fan-out during verification.
- **Superpowers coexistence (decided 2026-10-10).** Superpowers keeps
  process routing. pstack is explicit-call only inside the two autopilot
  sub-agent prompts. Repo conventions (`AGENTS.md`, `AUTOPILOT.md`,
  `DESIGN.md`) win on any conflict.

## What's left to the builder

- Pick the pin SHA at build time, verify each listed file at that SHA,
  and record the final file list + SHA.
- Exact one-line wiring wording in the two autopilot skills and the
  `AGENTS.md` paragraph, following surrounding comment density.
- Whether one physical copy plus a loader suffices for both harnesses,
  decided by reading how this repo's OpenCode and scheduled Claude Code
  sessions resolve skills, with the decision noted in the PR.
- Verification for the PR: `npm run check`, build, and a dry read-through
  that each named skill file loads (frontmatter parses, referenced
  playbook paths exist). No app e2e is expected unless the builder
  touches app code, which it should not. Self-review skill before open.
- Branch `feat/pstack-autopilot-<short-sha>` (or the repo's usual
  feature-branch shape), one concern only, Conventional Commit title,
  template filled in with bilingual release note written for users.
