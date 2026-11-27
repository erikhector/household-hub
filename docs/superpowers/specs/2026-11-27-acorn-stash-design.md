# Acorn stash: design

> **Conflicts with the current product rule.** REQUIREMENTS.md, "Household
> tasks", says tasks are:
>
> > deliberately **not** a chore-chart/points/rewards system like Tody or
> > OurHome: no fixed due dates or calendar schedule, no per-person scoring,
> > counts, streaks or leaderboard, in v1 or planned.
>
> and, under rotation, "Deliberately no counts, streaks, "done most" or
> member-vs-member comparison anywhere". The comment above `model
> HouseholdTask` in `prisma/schema.prisma` says the same ("explicitly not a
> chore-chart/points/rewards system ... no per-person scoring") and that "no
> separate completion-history table is needed".
>
> The owner asked for this feature anyway and chose to ship it as its own PR,
> clearly marked, updating the governance docs themselves at merge time. This
> PR does **not** edit REQUIREMENTS.md, PRODUCT.md, BACKLOG.md, AUTOPILOT.md
> or the `HouseholdTask` comment. If it merges, the owner needs to:
>
> 1. **REQUIREMENTS.md, "Household tasks"**: replace the "not a
>    chore-chart/points/rewards system ... in v1 or planned" sentence and the
>    rotation bullet's "Deliberately no counts, streaks ..." line with the
>    opt-in exception, and add an "Acorn stash" bullet describing the
>    behaviour below (model, toggle, card, undo, guardrails). The weekly recap
>    bullet's "never sorted or labeled by per-person count" still holds for
>    the recap itself.
> 2. **`prisma/schema.prisma`, the comment above `model HouseholdTask`**:
>    drop "explicitly not a chore-chart/points/rewards system" / "no
>    per-person scoring", and the closing "so no separate completion-history
>    table is needed", pointing at `TaskCompletion` instead. (The same
>    sentence in the header of `src/app/dashboard/tasks/recurrence.ts` is
>    about the open/closed derivation, which this doesn't change, but its
>    "There's no completion-history table" clause becomes stale too.)
> 3. **PRODUCT.md, Decision log**: a row recording the owner's decision to
>    allow an opt-in, default-off points/streak game on tasks, with the
>    guardrails below as its boundary.

## What it is

A light, opt-in chore game for household tasks. Each time someone ticks a
task they earn one acorn. A small "Acorn stash" card on the Tasks page shows
each current member's pile for this week, their current run of days, and
their all-time total, with a quiet "Busiest this week" badge on the week's
biggest pile. When you tick a task, an acorn drops onto your pile.

It is off by default and per household. While off, nothing about it renders
anywhere.

## Decisions

- **Toggle**: `Household.acornStashEnabled Boolean @default(false)`, a
  checkbox card in Household > Settings (`AcornStashSetting`, same shape as
  the low-stock auto-add switch) saved by `setAcornStashEnabledAction`.
  **Any member may change it**, not just the owner, following the auto-add
  switch: REQUIREMENTS.md's "Roles" keeps owner-only to removing members and
  deleting the household, and this only changes what the Tasks page shows.
- **History**: a new `TaskCompletion` model (`householdId` Cascade, `taskId`
  SetNull, `memberId` SetNull, `completedAt`, `acorns Int @default(1)`,
  indexes `[householdId, completedAt]` and `[taskId]`). Migration
  `task_completions_acorn_stash`.
  - `toggleTaskCompletedAction` writes a row **in the tick's transaction, on
    every completion, whether or not the stash is on**, so turning it on
    shows real history. Only a tick whose compare-and-set write matched
    writes a row (a double tap earns once).
  - **Undo** (an un-tick, which is the same action) deletes the row matched
    by household, task and the task's current `completedAt`, which the tick
    wrote with the same instant. That removes exactly the completion being
    undone and none of the task's earlier ones, whoever presses Undo. An
    undo that lost a race deletes nothing; reopening a task closed only by
    "Skip this time" leaves history alone (a skip never wrote one).
  - Recurring tasks earn every time. Deleting a task keeps its acorns.
  - Ticks made before this shipped have no rows; they earn nothing and their
    undo finds nothing to delete.
- **Sums** (`src/lib/tasks/acorn-stash.ts`, `computeAcornStash`, pure):
  - week: Monday-start, in the visitor's local time zone (the same
    `localDayNumber` the task schedule uses, UX-137);
  - all-time: every acorn;
  - streak: consecutive local days with at least one tick, ending today or
    yesterday (so it doesn't read as gone first thing in the morning);
  - members in join order, never sorted by pile size; completions by
    members who left (`memberId` null, or not in the current list) are left
    out; the leader badge goes to everyone tied for the top, and to nobody in
    a week with no acorns.
  - The page reads all of the current members' completions (three narrow
    columns each) only when the stash is on. Fine for any realistic
    household; if it ever isn't, the all-time total can move to a
    `groupBy` without changing the calculator's contract much.
- **Card** (`AcornStashCard`, on the Tasks page above the Mine/Everyone
  tabs): one row per member, two lines (pile, then name + badge, then a
  caption "3 days in a row · 27 in all"). Nothing in it is a tap target. The
  pile number has a screen-reader label ("4 acorns this week"); the visible
  digit is `aria-hidden`. Lucide `Nut` stands in for an acorn (no emoji).
- **Page subtitle**: the Tasks page's subtitle says "no scoring, no
  streaks". While the stash is on it reads `subtitleWithAcornStash` ("...
  with an acorn for every task done") instead, so the page doesn't
  contradict itself; with it off the subtitle is unchanged.
- **Acorn drop**: each tick by the viewer bumps a counter in `TasksClient`;
  the card mounts a fresh absolutely-placed `Nut` over their pile that falls
  in and fades over 900 ms (`acorn-drop` keyframes, motion tokens). It takes
  no space (no layout shift), plays only under `motion-safe`, and isn't
  rendered under `prefers-reduced-motion`. The "Done" toast stays the tick's
  real feedback (M5); the count updates when the save revalidates the page.
- **Data export**: completions are per-member rows, so the profile data
  export (SEC-10) gains `taskCompletions` (household, task title or null,
  completedAt, acorns).

## Guardrails

- No notifications, push or email about acorns or streaks, and nothing in
  the weekly digest.
- Nothing on money screens (budget, personal budget, Home's money tiles).
- No loss framing: a run that ended is simply not mentioned. No "streak
  lost", no red, no zero-shaming.
- Not on Home's Today block (the tick there still records a completion).

## Tests

- `src/lib/tasks/acorn-stash.test.ts`: weeks in local time vs UTC, bad
  zones, all-time, streak (today, yesterday, gaps, week boundary, local day
  boundary, DST), order, members who left, leader ties.
- `src/app/dashboard/tasks/actions.test.ts`: a row on complete (same
  instant, in the transaction), recurring earns again, none on a lost race
  or a forged id, undo deletes exactly the matching row scoped to the
  household, none on a lost undo or a skip-only reopen.
- `src/lib/actions/household.test.ts`: the toggle (session household only,
  any member, both directions, non-boolean rejected, no session).
- `e2e/acorn-stash.spec.ts`: enable in settings, tick a unique task, the
  card shows the acorn, Undo takes it away, disable hides the card. Runs on
  desktop and mobile, sets up and restores only its own worker household.
