# Agent progress: shared Checkbox component (UX_CONSISTENCY_BACKLOG item B)

## What was done

Extracted a shared `Checkbox` component and adopted it at the five call sites
named in the backlog item.

- **New file**: `src/components/ui/checkbox.tsx`
  - A plain styled native `<input type="checkbox">`, following this repo's
    shadcn-style wrapper pattern (`data-slot`, `cn(...)` merge, spread props),
    the same shape as `components/ui/input.tsx` and `components/ui/label.tsx`.
  - Checked `@base-ui/react`'s package exports first, per the task's
    instruction: it does ship a `./checkbox` module (`Checkbox` root +
    indicator parts). It was **not** used, because its API is
    `onCheckedChange(checked: boolean)`, not a native `onChange(event)` — and
    one of the five call sites (`transaction-dialog.tsx`) reads
    `e.target.checked` directly off the native event. Adopting the Base UI
    primitive would have required rewriting that wiring, which conflicts with
    the task's explicit instruction to preserve each call site's existing
    `checked`/`onChange`/`disabled` wiring exactly. A plain native-input
    wrapper keeps every existing handler unchanged.
  - Visual treatment: `size-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50`
    — the `accent-primary` look taken from `mark-cooked-dialog.tsx`, the one
    call site that was already on-brand, applied uniformly everywhere else.

- **Call sites updated** (native `<input type="checkbox">` → `<Checkbox>`,
  wiring preserved exactly):
  - `src/components/inventory/inventory-table.tsx` — select-all header
    checkbox, per-row desktop table checkbox, per-row mobile card checkbox
    (3 usages).
  - `src/components/shopping/shopping-list-client.tsx` — purchased-toggle
    checkbox in `ShoppingRow`.
  - `src/components/tasks/tasks-client.tsx` — complete-toggle checkbox in
    `TaskItemRow`.
  - `src/components/meal-planning/mark-cooked-dialog.tsx` — per-ingredient
    "include in this cook" checkbox.
  - `src/components/budget/transaction-dialog.tsx` — `isRecurring` and
    `splitEnabled` toggle checkboxes.

Out of scope (left untouched, per the task's explicit list of five files):
`src/components/meal-planning/missing-ingredients-dialog.tsx`,
`src/components/personal-budget/personal-transaction-dialog.tsx`, and
`src/components/shopping/shared-shopping-list-client.tsx` also hand-roll a
checkbox with the same `size-4 accent-primary` / `size-4 shrink-0` classes
and would be trivial follow-ups onto the same `Checkbox` component.

## Verification

- `npm run lint` — pass, no warnings or errors.
- `npx tsc --noEmit` — same 11 pre-existing errors as the unmodified baseline
  (confirmed by stashing my changes and re-running: `PageProps`/`LayoutProps`
  not found in 9 `app/**/page.tsx`/`layout.tsx` files, and
  `@/app/icon.png` module resolution in `brand-badge.tsx`). These come from
  Next.js's generated route types (`.next/types`), which aren't produced by
  a bare `tsc` run without `next build`/`next dev` — unrelated to this
  change. Zero new type errors introduced.
- `npm run test` (vitest) — 649 tests / 47 files, all passing.
- Manual visual check via a local `next dev` server (port 3450, run from
  this worktree) against the shared local Postgres (docker-compose), using
  an existing test household ("Empty Budget Test"):
  - **Inventory bulk-select** — added 7 pantry items via the starter kit;
    header "select all" and per-row checkboxes render with the purple
    `accent-primary` checked state, consistent in both the desktop table and
    the sm:hidden mobile card layout.
  - **Shopping list purchased-toggle** — created a list, added an item,
    toggled purchased; checkbox renders the same purple checked state and
    the purchased/cleared-state logic still works.
  - **Tasks complete-toggle** — added a task, toggled complete; same visual
    treatment, "Completed by" state updates correctly.
  - **Mark-cooked dialog** — created a recipe ("Toast") linked to the
    "Butter" inventory item, planned it, opened "Mark as cooked": the
    per-ingredient checkbox renders identically to the other four screens
    (this was already accent-primary before, now literally the same
    component).
  - **Budget transaction dialog** — added starter categories, opened "Add
    transaction", toggled "This repeats" (`isRecurring`): same purple
    checked state, reveals the frequency picker as before. (`splitEnabled`
    only renders for households with >1 member, not available in this test
    household, but it's the identical `<Checkbox>` usage/props shape as
    `isRecurring` in the same file, already exercised.)

All five screens now render the checkbox with one consistent look (purple
`accent-primary`, `size-4`) instead of the previous mix of unstyled,
`size-4 shrink-0`, and `size-4 accent-primary` variants.

Note: the dev-server verification environment is shared with other
concurrent agent sessions (same Postgres database/household, same browser
automation session). Test data created during verification (a few inventory
items, a shopping list, a task, a recipe, a meal-plan entry, and budget
categories on the "Empty Budget Test" household) was left in place rather
than deleted, to avoid racing with other sessions using the same data.
