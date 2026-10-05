# PRODUCT.md

Where Squirrel is heading, and the product decisions taken on the way.
The `autopilot-product` routine (see AUTOPILOT.md, "Product decisions")
maintains everything from "Direction" down. The owner writes this intro
and can overrule anything below by editing it on `master`, reverting a
decision's PR, or labelling a pending one `hold`.

Scouts read the Decision log before adding items, so a "no" here stays a
no until new evidence reopens it.

## Direction

Squirrel covers its original scope; what's left is making the everyday
loop (shopping list → receipt → pantry → meal plan → budget) take less
typing and work well on a phone in a store. Favour automation that
follows BACKLOG.md's Guardrails (suggest, don't silently mutate; works
with no AI key), mobile polish, and correctness of anything touching
money. Not now: new paid infrastructure, native apps, or features that
add notifications without something actually being wrong.

## Focus

Builder picks these, in order, right after `UX-` items.

1. `GAP-42` Cook mode on a recipe
2. `GAP-39` Offer to plan leftovers
3. `GAP-45` Fill empty days on the meal planner
4. `GAP-44` Freeze it on an inventory item
5. `GAP-43` Copy a recipe as plain text

## Owner inbox

Decisions only the owner can make, each with a recommended answer.

- `BUDGET-5`: should personal budget get its own starter categories?
  Recommended: yes, a short personal set via the same picker (money surface).
- `AUTO-13`: inbound receipt email? Recommended: yes as a first step, but
  it needs the owner to enable Resend inbound and accept temporary storage
  of receipt content.
- `PRICE-1`: wait; decide after AUTO-4 shows how much price data exists.
- `PERF-11`: check the Vercel and database regions in the dashboards; if
  they differ, pin `regions` (likely the biggest latency win).
- `GAP-35`, `GAP-36`, `GAP-37`, `GAP-38`, `GAP-41`: recommended no for now
  (new data model or money-math, no evidence of demand); `GAP-20`/`GAP-26`
  wait for real usage.

## Decision log

| Date | ID | Decision | Why | Reversible? |
|---|---|---|---|---|
| 2026-10-05 | GAP-43 | Build "copy recipe as text" only; no public share link | Delivers the need without the app's first unauthenticated read | Yes |
| 2026-10-05 | GAP-39 | Opt-in "Plan leftovers" prompt after cooking, no auto-scheduling | Suggest, don't silently mutate; no new state | Yes |
| 2026-10-05 | TASKS-1 | Keep not doing a "tasks cleared" bell alert | Item's own recommended default; weekly recap already covers it; Guardrails warn against noisy positive alerts | Yes |
