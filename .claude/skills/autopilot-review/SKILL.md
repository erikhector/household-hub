---
name: autopilot-review
description: Daily PR reviewer and merger for household-hub. The top-level session delegates each open PR's review to its own sub-agent (inline review comments, checking earlier comments were addressed and resolving them), then hands each passing PR, one at a time, to a merge sub-agent that keeps it mergeable (master merges, migration clashes, releases) and squash-merges it. The top level validates every sub-agent's result and reports. Use when a routine says "run autopilot-review".
---

# Autopilot reviewer

The second pair of eyes the builder doesn't have, and the one place PRs
get merged. It reviews, verifies fixes, keeps branches up to date and
merges. It does **not** fix review findings: that's the PR author's job
(the builder, for `autopilot` PRs), so review and fix stay independent.
The only commits it pushes are the mechanical pre-merge ones in step 4.

**Two roles.** The session the routine starts is the **coordinator**. It
gates, triages, starts one sub-agent per PR that needs a review round
(the `Agent` tool, `general-purpose`, in the background, several at
once), and one merge sub-agent per merge candidate (strictly one at a
time, since each merge moves `master`). It keeps track of them, validates
what each hands back against GitHub, and reports. It never reviews a diff
or resolves a conflict itself. Each **sub-agent** handles exactly one PR:
a whole diff in a fresh context gets a better review than the fifth PR in
a crowded one.

Every routine runs as the same GitHub account that opened the PRs, and
GitHub won't let you approve or request changes on your own PR. So every
review is a **comment** review and the verdict is recorded in text (see
Markers). Merge readiness is decided by this skill, not GitHub's review
state.

## Markers

Start every review body and inline comment this skill writes with
`🤖 autopilot-review`, and end each review body with
`<!-- autopilot-review sha=<head sha> verdict=<changes|approved> -->`.
That's how later runs (and the builder) tell reviewer threads from human
ones, and whether the head moved since the last review. Merge commits
this skill pushes itself (step 4) don't count as a moved head.

## 0. Gate (coordinator)

1. Read `AUTOPILOT.md`. Stop if `enabled` or `reviewer_enabled` is false.
2. List open PRs, oldest first: number, title, author, labels, draft flag,
   head SHA, mergeable state (one list call, no bodies). All authors are
   in scope. Skip drafts and anything labelled `hold`.
3. `git fetch origin` once, here. Sub-agents share this clone's object
   store and read `origin/<branch>` without fetching, so they never race
   on git's lock files.

## 1. Triage each PR (coordinator, cheap, no diff yet)

Fetch its review threads (GraphQL `reviewThreads` with `isResolved`, and
each comment's author, body and createdAt) and the last
`autopilot-review` review body. Then:

- **Head unchanged since the last verdict** and no new human comment:
  if that verdict was `approved`, it's a merge candidate (go to 3);
  otherwise skip it, nothing has happened yet.
- Otherwise it needs a review round (go to 2).

## 2. Delegate the review rounds (coordinator)

Start one **review sub-agent** per PR that needs a round, all in one
message with `run_in_background: true`, at most
`max_parallel_subagents` at a time (start the next as one finishes).
Reviews don't check anything out, so no worktree is needed. Each prompt
stands alone: the PR number, head SHA, the SHA of the last
`autopilot-review` verdict (if any), and an instruction to read
`.claude/skills/autopilot-review/SKILL.md` and follow `## Sub-agent:
review one PR` exactly, returning its report format. Track each one
(PR, agent id, status) and don't poll: reports arrive as notifications.

**Validate each report** against GitHub before accepting it:

- a new comment review exists on the PR, starts with
  `🤖 autopilot-review`, and its marker's `sha` is the PR's current head
  and its `verdict` matches the report;
- the number of inline comments and resolved threads matches the report,
  and every thread the sub-agent resolved was started by
  `autopilot-review` (never a human's);
- `approved` only if no review thread is left unresolved and nothing the
  review calls blocking or must-fix is open.

A mismatch goes back to that sub-agent with `SendMessage`, naming it.
After a second bad round, record the PR as `blocked: review failed
validation`, add the `needs-human` label, and move on. PRs whose
validated verdict is `approved` join the merge candidates (step 3).

## Sub-agent: review one PR

You review the one PR in your prompt and post one comment review. Other
sub-agents are reviewing other PRs at the same time. Don't `git fetch`
(the coordinator already did), don't check anything out, don't push, and
don't merge. Follow Markers above, then:

1. **Earlier findings first.** For each unresolved `autopilot-review`
   thread, look at the lines it points to on the new head and at any
   reply. Fixed, or answered with a reason you accept: reply one line
   saying what settled it and **resolve the thread**. Not fixed and no
   convincing reply: leave it open; it stays blocking. Never resolve a
   thread a human started, even if it looks answered.
2. **Then the diff**, in one call (the branch is already fetched):
   `git diff origin/master...origin/<branch> -- . ':!package-lock.json'`.
   If a previous review exists, only review what changed since its SHA
   (`git diff <old sha>..origin/<branch>`), so a PR isn't re-litigated
   every day.
3. Check it against AGENTS.md "Code review" and the `self-review`
   checklist (`.claude/skills/self-review/SKILL.md`), in that priority
   order; a diff that touches the UI is also checked against DESIGN.md's
   "UI review checklist", and each UX finding names the principle it
   breaks. Plus: Conventional Commit title, release note in both languages
   for a releasing type, Verification section filled in. Read
   surrounding code only where a hunk is ambiguous.
4. **Human-only areas** (AUTOPILOT.md) get a deeper pass, not a pass-by:
   read the whole changed function, not just the hunk. Schema: the
   migration matches `schema.prisma`, is additive or has a data-safe
   backfill, and nothing drops a column or table holding user data
   without the PR saying why. Auth/session: no route loses its guard.
   Money: a unit test pins every changed calculation. Data deletion:
   scoped by household, and the user confirms it in the UI.
5. Post **one** comment review: one inline comment per real finding
   (file:line, what's wrong, the concrete fix), most severe first. No
   style nits the linter would catch, no praise, no diff summary. A
   finding you're unsure about is a question, not a blocker by itself.
   Verdict `changes` if any blocking or must-fix finding or open thread
   remains, else `approved`. If the PR changes a file under AUTOPILOT.md's
   `never_merge_paths`, say in the review body that a human merges it
   (the coordinator adds the `needs-human` label).
6. **Report** exactly: PR number, head SHA reviewed, verdict, number of
   inline findings (blocking / questions), threads resolved (by id), and
   threads left open. Nothing else.

## 3. Merge candidates (coordinator)

A PR merges only if **all** hold:

- the last verdict is `approved` for the current head SHA;
- no unresolved review thread, reviewer's or human's;
- not a draft, no `hold` label;
- AUTOPILOT.md's merge policy allows it: `auto_merge: reviewer`, and no
  file under `never_merge_paths` changed (check the file list, not the
  labels). Such a PR still gets reviewed; say in the review that a human
  merges it, and add the `needs-human` label.

Merge at most `max_merges_per_review_run` per run, oldest first. At most
one PR that adds a migration per run, so each lands on a known schema.
Start merging only once every review sub-agent has reported and been
validated, so no review is still reading a branch that a merge moves.

## 4. Merge (one merge sub-agent per PR, one at a time)

Each merge moves `master`, so every candidate is re-verified on top of the
master it will land on. The coordinator starts one **merge sub-agent** per
candidate, oldest first, and waits for its report before starting the
next (`run_in_background: false` is right here: nothing else can proceed).
The prompt names the PR, its head SHA, and tells it to follow steps 4.1–4.6
below from `.claude/skills/autopilot-review/SKILL.md` in the main checkout,
then report: PR number, outcome (merged as vX.Y.Z / blocked: why), the
squash commit SHA, and the `npm run ci:local` summary lines (or "docs
only").

**Validate** before the next candidate: the PR is `MERGED` on GitHub with
the PR title as the commit title, `origin/master` (after `git fetch
origin master`) has that commit, the branch is deleted, and for a
releasing type `package.json` on master carries the reported version. A
blocked report must match a `changes` review on the PR saying why, and
stops further merges for this run if the cause was a failing `ci:local`.
A mismatch goes back to the sub-agent once with `SendMessage`; if it
still doesn't hold, stop merging this run and report it.

The merge sub-agent's steps:

1. **Update.** Check out the branch and merge `origin/master` into it
   (never rebase). Resolve conflicts per the `steward` skill's "Merge
   conflicts" rules.
2. **Migrations.** If master gained migrations since the branch forked
   and the PR adds one too: delete the PR's migration folder, bring up the
   local Postgres, `npx prisma migrate reset --force` (local only) and
   `npx prisma migrate dev --name <same name>`, so its migration is
   regenerated on top of master's. Check the new SQL does only what the
   old one did. Never edit a migration already on master. If the two
   schema changes contradict each other (same column, conflicting types),
   stop: comment the clash, verdict `changes`, move on.
3. **Judgment calls stop the merge.** A conflict in code both sides
   changed meaningfully: don't guess. Comment what conflicts, verdict
   `changes`, move on. The author resolves it.
4. **Release.** Releasing type (`feat`, `fix`, `perf`, `revert`, `!`)
   while `ci_gate` is `local`: cut its release as AGENTS.md "Pull
   requests and releases" describes (`node scripts/release.ts apply`,
   commit the three files, add the version to the INFRA-6 list in
   BACKLOG.md).
5. **Verify.** If the diff against master touches only `*.md` files, go
   to 6. Otherwise `npm run ci:local` must pass with no skipped tests.
   While `ci_gate` is `local`, ignore GitHub check runs. On failure, don't
   fix it: comment the failing step's last lines, verdict `changes`,
   don't push, and stop merging for this run.
6. **Merge.** Push, then squash-merge with the PR title as the commit
   title, delete the branch, and `git fetch origin master` so the
   coordinator and the next merge sub-agent start from the new master.

## 5. Report (coordinator)

Final message, one line per PR touched: number, what happened (N
findings / N threads resolved / merged as vX.Y.Z / blocked: why). Nothing
else.
