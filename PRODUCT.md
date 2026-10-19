# PRODUCT.md

Where Squirrel is heading, and the product decisions taken on the way.
The `autopilot-product` routine (see AUTOPILOT.md, "Product decisions")
maintains everything from "Direction" down. The owner writes this intro
and can overrule anything below by editing it on `master`, reverting a
decision's PR, or labelling a pending one `hold`.

Scouts read the Decision log before adding items, so a "no" here stays a
no until new evidence reopens it.

## Direction

Squirrel covers its original scope, and cook mode, step timers, leftovers, freezing, recipe copy and duplication have all shipped; what's left is making the everyday
loop (shopping list → receipt → pantry → meal plan → budget) take less
typing and work well on a phone in a store. Favour automation that
follows BACKLOG.md's Guardrails (suggest, don't silently mutate; works
with no AI key), mobile polish, and correctness of anything touching
money. Not now: new paid infrastructure, native apps, or features that
add notifications without something actually being wrong.

## Focus

Builder picks these, in order, right after `UX-` items.

1. `GAP-51` "Cook soon" shelf on the recipes tab
2. `GAP-55` Show when a recipe is planned on its detail view
3. `GAP-59` Search the meal plan
4. `GAP-56` Select several planned meals to move, re-portion or remove
5. `GAP-57` Opt-in "Tonight's dinner" morning nudge

## Owner inbox

Decisions only the owner can make, each with a recommended answer.

- `BUDGET-5`: should personal budget get its own starter categories?
  Recommended: yes, a short personal set via the same picker (money surface).
- `AUTO-13`: inbound receipt email? Recommended: yes as a first step, but
  it needs the owner to enable Resend inbound and accept temporary storage
  of receipt content.
- `UX-135`: sign in straight from the verification link? Recommended: yes,
  single-use token (auth surface). Decision issue opened.
- `UX-136`: opt-in sample data for a new household? Recommended: yes, tagged
  so one tap clears exactly those rows. Decision issue opened.
- `UX-138`: what "Safe to spend" subtracts? Recommended: subtract unspent
  limited-category remainder as its own line (money surface). Decision issue
  opened.
- `PRICE-1`: wait; decide after AUTO-4 shows how much price data exists.
- `PERF-11`: check the Vercel and database regions in the dashboards; if
  they differ, pin `regions` (likely the biggest latency win).
- `GAP-35`, `GAP-36`, `GAP-37`, `GAP-38`, `GAP-41`: recommended no for now
  (new data model or money-math, no evidence of demand); `GAP-20`/`GAP-26`
  wait for real usage.

## Decision log

| Date | ID | Decision | Why | Reversible? |
|---|---|---|---|---|
| 2026-10-19 | GAP-57 | Build the morning dinner nudge only as a per-user opt-in toggle, default off, one entry per day | Item's own recommendation; opt-in keeps Guardrails on noisy positive alerts | Yes |
| 2026-10-19 | UX-137 | Recurring tasks reschedule from the start of the local day; weekly+ keep an anchor day; no per-task mode yet | Item's own recommended option; fixes "Next due today" on completed rows with no schema | Yes |
| 2026-10-15 | UX-36 | Offline v1: cached shopping list plus a queue of ticks only; adds and price edits later | Smallest in-store slice with no merge conflicts; auth and money stay online-only | Yes |
| 2026-10-15 | UX-38 | Squirrel mark in empty states and a list-completed celebration; no new assets, no budget celebration | Ships now; Guardrails keep money surfaces free of celebration or loss-aversion | Yes |
| 2026-10-05 | GAP-43 | Build "copy recipe as text" only; no public share link | Delivers the need without the app's first unauthenticated read | Yes |
| 2026-10-05 | GAP-39 | Opt-in "Plan leftovers" prompt after cooking, no auto-scheduling | Suggest, don't silently mutate; no new state | Yes |
| 2026-10-05 | TASKS-1 | Keep not doing a "tasks cleared" bell alert | Item's own recommended default; weekly recap already covers it; Guardrails warn against noisy positive alerts | Yes |
