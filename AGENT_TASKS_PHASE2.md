# AGENT_TASKS_PHASE2.md

Playbook for building the Wave 1 / Wave 2 roadmap in `REQUIREMENTS.md` (added
after the competitive analysis in `Analyis_Comp.MD`) across multiple
subagents that build in **parallel, in isolated git worktrees**, the same
approach `AGENT_TASKS.md` used for the original feature build. This is an
operational playbook, not a product spec — `REQUIREMENTS.md` stays the
source of truth for *what the app is*; this file is about *how to divide and
land the new work without agents clobbering each other or losing progress*.

This doc is meant to be followed by a coordinating Claude Code session that
spawns the subagents below — most naturally via the `Agent` tool with
`isolation: "worktree"`. It is **not** an instruction for any single agent to
do all of this itself in one session.

## Ground rules for every subagent

Put these at the top of every subagent's prompt — don't assume a fresh agent
will infer them:

1. **Read `AGENTS.md`, `REQUIREMENTS.md` in full, and your task's relevant
   section of `Analyis_Comp.MD` before writing any code.** `AGENTS.md` points
   at this Next.js version's own docs in `node_modules/next/dist/docs/` —
   check the relevant guide there before using an API that might have
   changed. `REQUIREMENTS.md` documents the multi-tenancy model, data model,
   theming, i18n, navigation, and conventions this task must follow.
2. **Work in an isolated git worktree on its own branch** (e.g.
   `feature/meal-plan-shopping-bridge`), never directly on `main`/`master`.
3. **Scope creep is the enemy of parallel merges.** Touch only the files
   listed in the task's "Primary files" below unless a "Shared files" note
   says otherwise. If the work seems to require touching a file outside
   scope, stop and flag it rather than proceeding.
4. **Every domain query/mutation is scoped via `requireHousehold()`**
   (`src/lib/session.ts`) — never trust a client-supplied household id.
5. **Follow the existing action shape**: Server Actions bound to a `<form>`
   are `(prevState, formData) => Promise<ActionState>` with
   `ActionState = { error?: string }`, used with `useActionState`. Actions
   triggered by a plain click/toggle are called directly from a
   `useTransition` callback. Server Actions live next to the routes that use
   them (`src/app/dashboard/<feature>/actions.ts`) or in `src/lib/actions/`
   when shared.
6. **Base UI, not Radix**: compose with the `render` prop, never `asChild`.
   Reuse existing primitives in `src/components/ui/` — add a new one only if
   nothing there fits.
7. **Every new user-facing string goes into both dictionaries**
   (`src/lib/i18n/dictionaries/en.ts` *and* `sv.ts`, the latter actually
   translated, not copied). Pass the dictionary into Client Components via a
   `dict` prop. Use `format()`/`plural()` from `src/lib/i18n/format.ts` for
   interpolated/pluralized strings.
8. **Theming**: use existing CSS variables/Tailwind tokens only — never
   hardcode a color.
9. **Don't add new dependencies without checking what's already installed
   first** (`package.json`) — this codebase's convention (see the cost
   analyzer and Resend email integration) is to reach for a hand-rolled
   solution or the smallest possible dependency over a heavy library. If a
   task genuinely needs a new package, justify it in the REQUIREMENTS.md
   subsection you add.
10. **Track your own progress in a `PROGRESS.md` file at the root of your
    worktree**, so work survives a context/rate-limit cutoff and a fresh
    agent (or your own resumed session) can pick up exactly where you left
    off. Structure:
    ```markdown
    # Progress: <task name>

    ## Plan
    - [ ] Step 1 ...
    - [ ] Step 2 ...

    ## Status
    <one line: what's done, what's next, any blocker/decision made>

    ## Notes for a resuming agent
    <anything non-obvious: a decision you made and why, a gotcha you hit>
    ```
    Update it after every meaningful step (not just at the end) and **commit
    it along with the code** — a commit is the actual durability mechanism,
    not the file's mere existence in a dirty working tree. If you notice
    you're running low on context or approaching a limit, stop mid-task
    safely (finish the current file edit, don't leave broken code), update
    `PROGRESS.md` with precisely what's left, and commit. `PROGRESS.md` is
    scratch/coordination material — delete it in your final commit once the
    task is actually done and merged-ready (don't ship it into `main`).
11. **Definition of done** for every task, before handing back:
    - `npx tsc --noEmit -p tsconfig.json` — zero errors.
    - `npx eslint src` — zero errors/warnings.
    - `npm run build` — succeeds.
    - `npm test` — passes (add tests for new pure logic where it's
      reasonable, following the existing colocated `*.test.ts` convention —
      see "Testing" in REQUIREMENTS.md).
    - The feature's own new subsection added to `REQUIREMENTS.md` (in the
      matching spot — see the existing sections for voice/detail level), and
      its line removed from the "Roadmap" section.
    - `PROGRESS.md` deleted once the task is genuinely complete.
    - A commit (or a few logical commits) on the task's branch, not on
      `main`.

## Coordination mechanics

- **Isolation**: spawn each Wave task as its own `Agent` call with
  `isolation: "worktree"`. Safe to run all of one wave in a single batch of
  parallel `Agent` calls.
- **No schema migrations in Wave 1** — every Wave 1 task was deliberately
  scoped to need no new Prisma migration (verified against the current
  `prisma/schema.prisma` when this plan was written), which removes the
  shared-dev-Postgres concurrent-migration risk entirely for this wave.
- **Merge order**: land branches into `main` one at a time, running the
  Definition-of-Done checks after each merge before starting the next. This
  keeps `main` always in a working state and makes conflict resolution
  one-branch-at-a-time instead of an N-way tangle.
- **Where conflicts will happen**: `src/lib/i18n/dictionaries/en.ts` and
  `sv.ts` are the files every task touches — resolve by keeping both sides'
  additions, never picking one. `REQUIREMENTS.md` conflicts should be
  similarly additive (each task owns its own new subsection plus removing
  its own line from "Roadmap").
- **Wave 2 starts only after its Wave 1 dependency (if any) has merged to
  `main`** — rebase/re-create that agent's worktree from the post-merge
  `main`, don't branch it off the stale pre-merge tip.

## Wave 1 — fully independent, run in parallel

### 1. Meal-plan → shopping-list bridge

**Goal**: from the weekly meal-planning view, let the user generate/add
missing ingredients for planned meals to a shopping list. For a chosen scope
(the whole visible week, or a single day — your call, whole week is simplest
and matches the competitor pattern), collect every `MealPlanEntry` with a
`recipeId` in that range, gather each recipe's `RecipeIngredient` rows,
aggregate by the linked `InventoryItem` (sum quantities for the same item
across recipes/days), and diff against that item's current `quantity`. Only
ingredients whose required quantity exceeds what's on hand should be
proposed — don't propose items the household already has enough of.
Freeform meal entries (no `recipeId`) have no ingredients and are skipped.
Let the user review the proposed list (name + suggested quantity) before
committing, then either add to an existing `ACTIVE` shopping list (picked
from a select) or create a new one — reuse `findOrCreateInventoryItem`'s
existing pattern for item linkage, don't invent a new one. Show clearly
where the "add to shopping list" action lives in the meal-planning UI (e.g.
a button on the weekly planner, "Add missing ingredients to shopping list").

**Primary files**: `src/app/dashboard/meal-planning/` (actions + UI),
`src/app/dashboard/shopping-list/actions.ts` (new action or an exported
helper it can call — read this file fresh, don't assume its shape from
`REQUIREMENTS.md`'s description of it, which may have drifted).

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`.

**Out of scope**: recipe import (task 3), notifications about meal-plan gaps
(task 2) — don't do either's job.

### 2. In-app notification center

**Goal**: a bell icon (nav — desktop sidebar and mobile bottom-nav "More"
menu, matching how the theme/language toggles are placed in both) that opens
a dropdown/panel listing live-computed alerts for the active household — no
new database table, no background job, no email. Compute on each render
(Server Component, scoped via `requireHousehold()`):
- **Low stock**: every `InventoryItem` where `quantity <= lowStockThreshold`,
  the same predicate the inventory page's status filter already uses — reuse
  it, don't reimplement it (find where that logic lives today, e.g. a
  `getStockStatus`-style helper, and import it rather than duplicating the
  condition).
- **Meal-plan gaps**: for a short lookahead window (e.g. today + the next 2
  days), any date with zero `MealPlanEntry` rows for any `MealType` — a
  simple "no dinner planned for tomorrow" style nudge. Keep the window small
  so this stays cheap and genuinely useful, not noisy.
Show a badge count (total alerts) on the bell; clicking an alert navigates to
the relevant page (inventory filtered to low-stock, or the meal-planning week
containing the gap date). No "mark as read"/dismiss persistence for this
pass — since nothing is stored, alerts simply recompute and disappear once
the underlying condition is resolved (stock replenished, meal added). Don't
build a `Notification` database model — that's unnecessary state for what's
currently a live, derived view.

**Primary files**: new `src/components/notifications/` (bell + panel), a new
small server-side query helper (e.g.
`src/lib/notifications.ts` or colocated with the components), wiring into
`src/components/dashboard/sidebar.tsx` and `src/components/dashboard/bottom-nav.tsx`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`. Do **not** touch
`nav-items.ts` unless you determine it's genuinely needed for this (it
shouldn't be — the bell isn't a nav section, it's a nav-bar-adjacent widget,
same tier as the theme/language toggles).

**Out of scope**: email notifications/digests (no scheduler exists in this
app — flagged as a future decision in `REQUIREMENTS.md`, don't build one
here), bill-due reminders (no due-date concept exists on `Transaction`).

### 3. Recipe import from URL

**Goal**: in the recipe create/edit dialog (`RecipeFormDialog`), add a
"Import from URL" input + button above the manual fields. A Server Action
takes the URL, validates it (must be `http`/`https`; **do not fetch
localhost/private/link-local IP ranges or non-http(s) schemes** — this is a
server-side fetch of a user-supplied URL, so guard against SSRF the same way
you'd guard any server-side fetch of untrusted input), fetches the page HTML,
and looks for a `schema.org/Recipe` object in a `<script
type="application/ld+json">` block (this is what essentially every recipe
site embeds — Paprika/AnyList's "recipe clipper" features work the same way).
A simple regex extraction of `<script type="application/ld+json">...</script>`
blocks + `JSON.parse` + a scan for an object (or an item inside an `@graph`
array) whose `@type` includes `"Recipe"` is sufficient — don't add a full DOM
parser (`cheerio`/`jsdom`) unless the regex approach proves genuinely
insufficient after trying it against a couple of real recipe sites; check
`package.json` first either way per ground rule 9. Map the parsed fields to
the existing form: `name`, `recipeIngredients` (schema.org's `recipeIngredient`
is a flat array of strings like `"2 cups flour"` — best-effort split into
quantity/unit/name, e.g. via a leading-number regex; when it can't confidently
split, put the whole string in `name` with quantity `1` rather than guessing
wrong), `instructions` (schema.org's `recipeInstructions` can be a string, an
array of strings, or an array of `HowToStep` objects — flatten to plain text,
one step per line). Populate the form fields for the user to review/edit
before saving — never auto-save an imported recipe without the user
confirming. If no Recipe schema is found, show a clear error ("couldn't read
a recipe from that page") rather than a silent no-op or a crash — this will
fail on plenty of real-world pages and that's expected.

**Primary files**: `src/app/dashboard/meal-planning/actions.ts` (new
`importRecipeFromUrlAction`), new `src/lib/recipe-import.ts` (the parsing
logic — pure functions, testable without a network call), `RecipeFormDialog`
(`src/components/meal-planning/` — exact filename may have changed, check).

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`.

**Testing**: the parsing logic in `src/lib/recipe-import.ts` (JSON-LD
extraction, ingredient-string splitting, instruction flattening) should be
pure and unit-testable with inline HTML/JSON fixtures — no real network
calls in tests, per the existing "Database isolation" testing convention's
spirit (don't depend on external services in `npm test`).

### 4. Data export (CSV)

**Goal**: an "Export CSV" action available in three places, each exporting
that household's own scoped data:
- **Inventory** (`/dashboard/inventory`): every `InventoryItem` — name,
  category, quantity, unit, location, low-stock threshold, last known price.
- **A shopping list** (`/dashboard/shopping-list/[id]`): that list's items —
  name, quantity, estimated price, purchased (yes/no).
- **Budget transactions** (`/dashboard/budget`): every `Transaction` in the
  currently-viewed period (reuse whatever period/filter the page already
  has — likely the current month, matching `PeriodSummary`) — date,
  category, type, amount, description, recurring (yes/no).
Implement as a Route Handler per export (e.g.
`src/app/dashboard/inventory/export/route.ts`) that re-derives the household
via `requireHousehold()` (never a client-supplied id/query param for
household scoping), builds a CSV string (plain string-building with proper
quoting/escaping of commas and quotes — no need for a CSV library for this
shape of data, but check `package.json` first per ground rule 9 in case one's
already installed for another reason), and returns it with
`Content-Type: text/csv` and a `Content-Disposition: attachment;
filename="..."` header. Add a small "Export CSV" button (with a download
icon) near each page's existing header controls.

**Primary files**: new `src/app/dashboard/inventory/export/route.ts`,
`src/app/dashboard/shopping-list/[id]/export/route.ts`,
`src/app/dashboard/budget/export/route.ts`, plus one small button component
each (or one shared `ExportCsvButton` component parameterized by href, in
`src/components/ui/` or a new `src/components/export/`).

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (button label,
any error text).

**Out of scope**: PDF export, importing CSV back in — export only, one
direction.

### 5. Budget "safe to spend" stat

**Goal**: a prominent stat card at the top of the Budget page's Overview tab
(above or beside the existing `PeriodSummary`), showing a single number: this
calendar month's income total minus this month's expense total so far
(the same `[monthStart, monthEnd)` window `PeriodSummary` already computes —
reuse it) minus an estimate of **recurring expenses that haven't posted yet
this month**. Compute that estimate like this: for every `BudgetCategory` of
type `EXPENSE` that has at least one `Transaction` with `isRecurring: true`
in a prior month, check whether that category already has a `Transaction`
dated in the current month; if not, take the amount of its most recent
recurring transaction (by `date`) as the "expected but not yet logged"
amount for that category, and subtract the sum of all such amounts from the
headline number. Show the headline number prominently, and beneath it a
small breakdown of which recurring categories were counted as "expected"
(so the number isn't a black box) — e.g. "Rent (–$1,200) not yet logged this
month". This is a best-effort estimate, not a scheduler — say so if there's
a natural place for a one-line caveat, but don't over-engineer a tooltip
system for it.

**Primary files**: `src/app/dashboard/budget/page.tsx` (the aggregation,
alongside the existing month-window logic), new
`src/components/budget/safe-to-spend.tsx` (presentational, same pattern as
`PeriodSummary`/`CostAnalyzer` — Server Component does aggregation, this
component just renders).

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (extend the
existing `budget` namespace).

**Out of scope**: the cost analyzer tab (task already built), the
expense-splitting feature (Wave 2 task 7) — don't touch either.

## Wave 2 — start after Wave 1 merges

### 6. Barcode scanning for inventory/shopping entry

**Depends on**: nothing structurally, but sequenced into Wave 2 for
complexity/risk reasons (new browser API surface, external network call) —
land after Wave 1 settles so this doesn't compete for review attention
against five simultaneous merges.

**Goal**: a "Scan barcode" button (on the inventory add-item form and the
shopping list ad-hoc-add form) that opens the device camera (via
`navigator.mediaDevices.getUserMedia`) and decodes a barcode client-side.
Check `package.json` first, then pick the lightest viable barcode-decoding
library (a UMD/ESM browser-side decoder — research what's current and
well-maintained; don't assume a specific package name from training data
without checking it still exists and is maintained). On a successful scan,
look up the barcode via **Open Food Facts's public API**
(`https://world.openfoodfacts.org/api/v2/product/<barcode>.json` — free, no
API key) to get a product name; on lookup failure or a non-food item,
gracefully fall back to letting the user type the name manually with the
barcode number shown for reference, don't block the flow. This must degrade
cleanly when camera permission is denied or unavailable (desktop with no
webcam, permission refused) — the manual entry form must keep working
exactly as it does today; the scan button is additive.

**Primary files**: new `src/components/inventory/barcode-scanner.tsx` (or a
shared `src/components/shared/barcode-scanner.tsx` if reused identically by
both forms), wiring into the inventory add-item form and the shopping list
ad-hoc-add form.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`, `package.json`
(new scanning dependency).

**Privacy note**: camera access is client-side only for decoding; don't send
frames/images anywhere. Only the decoded barcode number is sent to Open Food
Facts.

### 7. Household contribution/expense splitting

**Depends on**: nothing new structurally beyond the existing Budget module
(already built), sequenced into Wave 2 because it's a real schema addition
that deserves to land without four other Wave 1 branches also mid-flight
against the same `Transaction`-adjacent area.

**Goal**: for households with more than one member, let a `Transaction`
optionally record who paid and how it's split among members (even shares by
default; let the payer adjust per-member shares/amounts), then surface a
"who owes whom" net balance view (Splitwise's debt-simplification pattern:
net every pairwise balance down to the minimum number of settle-up
transfers, not a raw list of every individual expense's split) somewhere on
the Household or Budget page — your call which fits better, document the
choice in your `REQUIREMENTS.md` subsection. This needs new Prisma models
(**this task does need a migration** — unlike Wave 1): something like a
`TransactionSplit` join table (`transactionId`, `householdMemberId`, `share`
or `amountOwed`) plus a `paidByMemberId` on `Transaction`. Hand-write the
migration SQL following the existing files in `prisma/migrations/` as the
template for a non-interactive `ALTER TABLE`/`CREATE TABLE`, per the
Definition-of-Done note on migrations in `AGENT_TASKS.md`. Apply it against
the shared dev Postgres (`docker compose up -d` if not running) before
relying on the new tables. This is opt-in per transaction — a transaction
with no split behaves exactly as today (no `paidByMemberId`/splits set).

**Primary files**: `prisma/schema.prisma` + a new migration,
`src/app/dashboard/budget/actions.ts` (extend
`createTransactionAction`/`updateTransactionAction`), `TransactionDialog`
(add optional "paid by" + split UI), a new settle-up view component.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`.

**Out of scope**: actually moving money/marking a settle-up as paid should
just be a manual "mark settled" action (e.g. a note or a zeroing
transaction) — no payment processing integration of any kind.

## REQUIREMENTS.md subsection convention

Same as `AGENT_TASKS.md`'s original convention: each task appends its own
new `##`-level (or nested `###` under an existing `##`) subsection
describing what it built, in the same voice and level of detail as the
existing sections. Move the corresponding line out of the new "Roadmap"
section once the feature lands. Don't rewrite sections you didn't build.
