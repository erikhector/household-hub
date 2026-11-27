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
biggest pile. When a tick of yours earns an acorn, one drops onto your pile.

It is off by default and per household. While off, nothing about it renders
anywhere and no ticks are recorded for it: turning it on starts everyone
from zero.

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
  - `toggleTaskCompletedAction` writes a row **in the tick's transaction,
    and only while the stash is on** (owner's decision): it reads
    `acornStashEnabled` inside that transaction, for the session's
    household. Turning it on starts from zero; turning it off stops the
    counting and keeps what was earned. Only a tick whose compare-and-set
    write matched writes a row (a double tap earns once).
  - **Undo** (owner's rule): an un-tick takes the acorn back **only within
    the undo window**, i.e. when it is the toast's Undo of a recent tick.
    Unticking or reopening a task later still puts the task back as before
    (UX-102), but keeps the acorn the earlier completion earned. The toast's
    Undo and a manual untick are the same `toggleTaskCompletedAction` call,
    so the server tells them apart by the tick's age: the row is deleted
    only when `now - task.completedAt <= TASK_UNDO_WINDOW_MS`
    (`src/lib/tasks/undo-window.ts`), which is the "Done" toast's
    `TASK_DONE_TOAST_MS` (5 s, shared by the Tasks page and Home's Today
    block) plus a 10 s grace, because Sonner pauses the toast's timer while
    it's hovered or the tab is hidden and the request takes a moment. Age
    rather than a client flag, so nothing the client sends decides it. An
    untick inside the window that wasn't the Undo button (a quick second tap
    on the checkbox) counts as the undo too, which is what it is.
  - **Re-tick after a late untick earns 0** (owner's decision). A late
    untick keeps its row and puts the task's `completedAt` back to the
    completion before, so the kept row is newer than the task's
    `completedAt`. Inside the tick's transaction, before writing its row,
    the action looks for a row of this household and task newer than the
    `completedAt` it read (any row at all when that is null, a first tick
    unticked late); if there is one, the new row is written with
    `acorns: 0`. The kept row already paid for the chore, whether the
    re-tick comes a minute later or when a recurring task next falls due.
    A genuine later repeat of a recurring task finds no newer row (every
    earlier row is at or before the `completedAt` it read) and earns 1.
    The action returns `earnedAcorn: true` only for a tick that wrote a
    1-acorn row, which is what drops the acorn on the card.
  - **Undo never outlives the window on screen**: Sonner pauses a toast's
    timer while it's hovered, the stack is expanded or the tab is hidden,
    so the "Done" toast could offer Undo long after the server would ignore
    it as one. Both the Tasks page and Home's Today block start a timer at
    tick time that dismisses the toast at `TASK_UNDO_WINDOW_MS` minus a
    3 s margin (`capUndoToast`, `src/components/tasks/undo-toast-cap.ts`),
    cleared when the toast closes any other way; once it has closed, the
    "used up" update (GAP-87) no longer re-shows it. The timer isn't
    cleared on unmount: the toast lives in the app-wide Toaster and its
    Undo still works after the component that showed it is gone, so the
    stop has to outlive it too. The server rule is unchanged.
  - The deletion matches by household, task and the task's current
    `completedAt`, which the tick wrote with the same instant. That removes
    exactly the completion being undone and none of the task's earlier ones,
    whoever presses Undo. An undo that lost a race deletes nothing;
    reopening a task closed only by "Skip this time" leaves history alone (a
    skip never wrote one).
  - **Sample data**: "Clear sample data" deletes the completions of sample
    tasks before the tasks (a task's delete alone would only null their
    `taskId`), so no acorns outlive chores the household never had.
  - Recurring tasks earn every time. Deleting a task keeps its acorns.
  - Ticks made before this shipped, or while the stash was off, have no
    rows; they earn nothing and their undo finds nothing to delete.
- **Sums** (`src/lib/tasks/acorn-stash.ts`: `computeAcornStash`, pure, and
  `loadAcornStash`, its two reads):
  - week: Monday-start, in the visitor's local time zone (the time-zone
    cookie; the same local-day arithmetic the task schedule uses, UX-137),
    with one `Intl.DateTimeFormat` per computation (`localDayNumberIn`)
    rather than one per row;
  - all-time: every acorn, summed in the database (`groupBy` by member,
    `_sum.acorns`, scoped to the household and its current members); the
    week sums `acorns` too, so piles count acorns, never rows, and a
    0-acorn re-tick adds nothing;
  - streak: consecutive local days with at least one acorn earned, ending
    today or yesterday (so it doesn't read as gone first thing in the
    morning), counted up to `ACORN_STREAK_CAP_DAYS` (365). A 0-acorn row
    doesn't extend a streak: the re-tick is the same chore again, already
    paid for, so a day holding only that isn't a day of chores done;
  - members in join order, never sorted by pile size; completions by
    members who left (`memberId` null, or not in the current list) are left
    out; the leader badge goes to everyone tied for the top, and to nobody in
    a week with no acorns or in a household of one (where "busiest" could
    only mean "you").
  - **Bounded reads**, only when the stash is on: every render of the
    Tasks page (and every tick, which revalidates it) runs the `groupBy`
    and fetches rows only from the last 365 + 2 days (this week and a
    capped streak; the 2 extra days cover any zone offset or DST change on
    the earliest day). So the cost doesn't grow with the household's
    history. A run longer than the cap reads as "365 days in a row":
    still true, and simpler than an unbounded walk for a number nobody
    checks against a calendar.
- **Card** (`AcornStashCard`, on the Tasks page **below the open tasks**,
  above "Upcoming" and "Completed", or below the empty state): DESIGN.md M6 puts the open
  tasks first and secondary information behind a disclosure, so the card
  is a native `<details>`, **collapsed by default** (the ProfileDisclosure
  pattern: no JS, a 44 px summary row). Collapsed it's one row: the title,
  the viewer's own pile for this week ("You have 4 acorns this week" for a
  screen reader) and a chevron. Opened, one row per member: pile, then
  name + badge on one line, then a caption "3 days in a row · 27 in all".
  The name line never wraps (the name truncates, with its full text in
  `title`), so the leader badge appearing after a tick can't add a line and
  shift anything under the thumb (M5). It sits inside the tasks' flip
  list with its own key, so it glides up when a ticked row leaves. It is
  rendered once, at a fixed place in that list (after the open section's
  ternary of empty state / "Mine" empty / open rows, before the rest), not
  once per branch, so React keeps the same `<details>`: an open card doesn't
  fold shut or replay the drop when the list empties or fills. Each
  pile's visible digit is `aria-hidden` and the screen-reader sentence is
  a separate element with a space between them, so the page text never
  reads "33 acorns" for 3. Lucide `Nut` stands in for an acorn (no emoji).
  The open state isn't remembered between visits (no new browser storage).
- **Page subtitle**: the Tasks page's subtitle says "no scoring, no
  streaks". While the stash is on it reads `subtitleWithAcornStash` ("...
  with an acorn for every task done") instead, so the page doesn't
  contradict itself; with it off the subtitle is unchanged.
- **Acorn drop**: each tick by the viewer whose save answers
  `earnedAcorn` bumps a counter in `TasksClient` (so not at tap time, but
  once the server confirms the tick landed and earned something: a failed
  save or a 0-acorn re-tick drops nothing); the card mounts a fresh absolutely-placed `Nut` over their pile on the
  summary row (so it shows collapsed or open) that falls in on
  `duration-spring` with `ease-spring`, rests for `duration-base` and fades
  on `duration-fast` with `ease-in` (`acorn-drop-fall` / `acorn-drop-fade`,
  DESIGN.md's motion tokens; 720 ms in all). It takes
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
- Not on Home's Today block (a tick there still records a completion while
  the stash is on).

## Tests

- `src/lib/tasks/acorn-stash.test.ts`: weeks in local time vs UTC, bad
  zones, all-time from the database sums, 0-acorn rows adding nothing,
  streak (today, yesterday, gaps, week boundary, local day boundary, DST,
  the cap, a 0-acorn day not counting), order, members who left, leader
  ties and no leader in a household of one; `loadAcornStash`'s
  household-scoped `groupBy` and its bounded window (mocked Prisma).
- `src/app/dashboard/tasks/actions.test.ts`: no row while the stash is
  off, a row on complete (same instant, in the transaction,
  `earnedAcorn` returned), a re-tick after a late untick written with 0
  acorns (and a first tick's, with no completedAt), a later repeat with no
  newer row earning 1, recurring earns again, none on a lost race
  or a forged id, undo deletes exactly the matching row scoped to the
  household (also late in the toast, within the grace), a later untick
  keeps it, none on a lost undo or a skip-only reopen.
- `src/components/tasks/undo-toast-cap.test.ts`: the cap sits between the
  toast's 5 s and the server window, dismisses a still-open toast when it
  runs out, and is cleared when the toast closes any other way.
- `src/lib/actions/sample-data.test.ts`: clearing sample data deletes the
  sample tasks' completions, before the tasks.
- `src/lib/actions/household.test.ts`: the toggle (session household only,
  any member, both directions, non-boolean rejected, no session).
- `e2e/acorn-stash.spec.ts`: enable in settings; the card sits below the
  open tasks, collapsed, showing the viewer's pile; it opens to a row per
  member; tick a unique task, both piles go up by one and the viewer's row
  keeps its height; Undo takes the acorn away (also after a reload);
  disable hides the card. Two of the viewer's ticks are seeded first, so
  the counts are read from a pile above 0. A second test seeds what a late
  untick leaves (the task open, its row kept), turns the stash on, ticks
  the task again and checks the pile hasn't moved after a reload and the
  new row holds 0 acorns. Runs on desktop and mobile, sets up and restores
  only its own worker household.
