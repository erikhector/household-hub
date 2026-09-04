# AGENT_TASKS.md

Playbook for splitting the remaining Household Hub work (see
REQUIREMENTS.md's "Not yet built") across multiple subagents that build in
**parallel, in isolated git worktrees**, while staying consistent with the
app's existing architecture and conventions. This is an operational
playbook, not a product spec — REQUIREMENTS.md stays the source of truth
for *what the app is*; this file is about *how to divide and land the work
without agents clobbering each other*.

This doc is meant to be followed by a coordinating Claude Code session (a
human driving Claude Code, or a top-level agent session) that spawns the
subagents below — most naturally via the `Agent` tool with
`isolation: "worktree"`, which gives each task its own git worktree and
branch automatically. It is **not** an instruction for any single agent to
do all of this itself in one session.

## Ground rules for every subagent

Put these at the top of every subagent's prompt — don't assume a fresh
agent will infer them:

1. **Read `AGENTS.md` and `REQUIREMENTS.md` in full before writing any
   code.** `AGENTS.md` points at this Next.js version's own docs in
   `node_modules/next/dist/docs/` — check the relevant guide there before
   using an API that might have changed. REQUIREMENTS.md documents the
   multi-tenancy model, data model, theming, i18n, navigation, and
   conventions this task must follow.
2. **Work in an isolated git worktree on its own branch** (e.g.
   `feature/meal-planning`), never directly on `main`/`master`. This is
   what makes true parallelism safe — two agents editing the same repo
   working tree at once will corrupt each other's work.
3. **Scope creep is the enemy of parallel merges.** Touch only the files
   listed in the task's "Primary files" below unless a "Shared files" note
   says otherwise. If the work seems to require touching a file outside
   scope, stop and flag it rather than proceeding — that's a sign the task
   split needs adjusting, not a green light to expand scope.
4. **Every domain query/mutation is scoped via `requireHousehold()`**
   (`src/lib/session.ts`) — never trust a client-supplied household id, and
   never bypass it. Owner-only actions check `role === "OWNER"` from that
   same call (see `src/lib/actions/household.ts` for the pattern), never
   from client input.
5. **Follow the existing action shape**: Server Actions bound to a `<form>`
   are `(prevState, formData) => Promise<ActionState>` with
   `ActionState = { error?: string }`, used with `useActionState`. Actions
   triggered by a plain click/toggle are called directly from a
   `useTransition` callback. Server Actions live next to the routes that
   use them (`src/app/dashboard/<feature>/actions.ts`) or in
   `src/lib/actions/` when shared.
6. **Base UI, not Radix**: compose with the `render` prop
   (`<DialogTrigger render={<Button>...</Button>} />`), never `asChild`.
   Reuse existing primitives in `src/components/ui/` — add a new one only
   if nothing there fits, and put it in `src/components/ui/` following the
   existing file style (see `button.tsx`/`badge.tsx` for the
   `cva` + `cn` pattern).
7. **Every new user-facing string goes into both dictionaries.** Add keys
   to `src/lib/i18n/dictionaries/en.ts` *and* `sv.ts` (the latter is typed
   `satisfies Dictionary`, so a missing key fails the build — but a
   half-translated `sv.ts` entry won't, so actually translate it, don't
   just copy the English string). Pass the dictionary into Client
   Components via a `dict` prop, following the pattern in
   `src/app/dashboard/household/page.tsx` /
   `src/components/household/member-list.tsx`. Use `format()`/`plural()`
   from `src/lib/i18n/format.ts` for interpolated/pluralized strings. Fetch
   with `getDictionary()` (`src/lib/i18n/get-dictionary.ts`) in each Server
   Component/page that needs it — don't prop-drill from the root layout.
8. **Theming**: use existing CSS variables/Tailwind tokens (`bg-card`,
   `text-muted-foreground`, `--primary`, etc.) — never hardcode a color.
   Both the light and dark palettes are defined once in
   `src/app/globals.css`; a new UI element styled only with existing
   tokens works in both automatically. Don't add theme-specific
   conditionals in components.
9. **Definition of done** for every task, before handing back:
   - `npx tsc --noEmit -p tsconfig.json` — zero errors.
   - `npx eslint src` — zero errors/warnings.
   - `npm run build` — succeeds.
   - New Prisma migrations (if any) applied via `npx prisma migrate deploy`
     against the shared dev Postgres (`docker compose up -d` if it isn't
     already running) — **not** `prisma migrate dev`, which refuses to run
     non-interactively; hand-write the migration SQL following the existing
     files in `prisma/migrations/` if `migrate dev` isn't available, the
     same way the role-rename migration in this repo's history was written.
   - The feature's own new subsection added to REQUIREMENTS.md (see below)
     and, if it changes something an *existing* REQUIREMENTS.md section
     describes, that section updated too.
   - A commit (or a few logical commits) on the task's branch, not on
     `main`.

## Coordination mechanics

- **Isolation**: spawn each Wave-1 task as its own `Agent` call with
  `isolation: "worktree"`. Each gets a clean worktree off the current
  `main`/`master` tip and its own branch — safe to run all of Wave 1 in a
  single batch of parallel `Agent` calls.
- **The shared dev database is one Postgres instance** (`docker-compose.yml`),
  not per-worktree. None of the tasks below require schema changes, so this
  mostly doesn't matter — but if a task turns out to need one, apply its
  migration before other agents start relying on the new columns/tables,
  and don't run two `prisma migrate deploy`s concurrently.
- **Merge order**: land Wave 1 branches into `main` one at a time (not by
  merging all worktrees simultaneously), running the Definition-of-Done
  checks after each merge before starting the next. This keeps `main`
  always in a working state and makes conflict resolution one-branch-at-a-
  time instead of an N-way tangle.
- **Where conflicts will happen**: `src/lib/i18n/dictionaries/en.ts` and
  `sv.ts` are the files every task touches. Conflicts there are almost
  always "both sides added new keys" — resolve by keeping both additions,
  not by picking one side. `REQUIREMENTS.md` conflicts should be similarly
  additive (each task owns its own new subsection). If a task's diff
  touches `nav-items.ts`, that's a signal to double-check it's actually
  needed — every nav section this round of tasks needs already exists.
- **Wave 2 starts only after its Wave-1 dependency has merged to `main`** —
  rebase/re-create that agent's worktree from the post-merge `main`, don't
  branch it off the stale pre-merge tip.

## Wave 1 — fully independent, run in parallel

### 1. Meal planning UI

**Goal**: build the UI for the existing `Recipe` / `RecipeIngredient` /
`MealPlan` / `MealPlanEntry` models (schema already in
`prisma/schema.prisma` — no migration needed). Recipe CRUD, and a weekly
planner view that assigns a recipe (or a freeform meal name, via
`freeformName`) to a date + `MealType` (`BREAKFAST`/`LUNCH`/`DINNER`/
`SNACK`), scoped by `MealPlan.weekStartDate`. Ingredients optionally link to
an `InventoryItem` the same way shopping list items do (find-or-create by
case-insensitive name match within the household — see
`findOrCreateInventoryItem` in
`src/app/dashboard/shopping-list/actions.ts` for the exact pattern to
replicate, don't invent a different one).

**Primary files**: `src/app/dashboard/meal-planning/` (currently a
placeholder page — replace it), new `src/components/meal-planning/`, new
`src/app/dashboard/meal-planning/actions.ts`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (add a
`mealPlanning` namespace).

**Out of scope**: linking meal plans to the shopping list or budget (not
requested yet — don't invent it).

### 2. Budgeting UI

**Goal**: build the UI for the existing `BudgetCategory` / `Transaction`
models (schema already in `prisma/schema.prisma` — no migration needed).
Category management (income/expense, `TransactionType`), a transaction
list with add/edit/delete, recurring transaction support
(`isRecurring` + `RecurrenceFrequency`), and some kind of period summary
(e.g. this month's income vs. expense by category) on the Budget page.

**Primary files**: `src/app/dashboard/budget/` (currently a placeholder
page — replace it), new `src/components/budget/`, new
`src/app/dashboard/budget/actions.ts`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (add a `budget`
namespace).

**Note for Wave 2**: name the "Groceries" seed/lookup category in a way
that's easy for Task 8 (shopping-list → budget link) to find or
find-or-create later — e.g. a small exported helper like
`findOrCreateGroceriesCategory(householdId)` in
`src/app/dashboard/budget/actions.ts`, mirroring the
`findOrCreateInventoryItem` pattern. Document the exact name/lookup key you
use in your REQUIREMENTS.md subsection so Task 8 doesn't have to guess.

**Out of scope**: the cost analyzer (Task 7) and the shopping-list expense
link (Task 8) — both build on top of this in Wave 2, don't do their job
for them.

### 3. Profile enhancements

**Goal**: extend `/dashboard/profile` (currently just display-name editing)
with email change (needs re-verification thought-through — a naive
unverified email swap is a real security regression since email is the
login identifier; at minimum require re-entering the current password to
confirm the change) and password change (current password + new password +
confirmation, using the existing `bcryptjs` hashing already used in
`src/lib/actions/auth.ts`). Add avatar support — a simple approach (e.g. an
uploaded image stored somewhere reasonable, or a deterministic
generated/initial-based avatar if file storage is out of scope for this
pass) is fine; don't over-build this into a full media pipeline.

**Primary files**: `src/app/dashboard/profile/`,
`src/components/profile/profile-form.tsx` (extend or split into multiple
forms — a single form mixing display name / email / password changes into
one submit is probably the wrong shape; look at how `login-form.tsx` /
`signup-form.tsx` structure separate concerns).

**Schema note**: an avatar likely needs a new `User.avatarUrl String?`
field (or similar) — if so, this task *does* need a migration; hand-write
it following `prisma/migrations/20260904220000_.../migration.sql` as the
template for a non-interactive `ALTER TABLE`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (extend the
existing `profile` namespace).

### 4. Test framework setup + smoke tests

**Goal**: stand up a real test suite — this repo has none yet, and
REQUIREMENTS.md is explicit that the autonomous build/improve loop is
intentionally gated on one existing. Pick a stack appropriate for this
Next.js version (check `node_modules/next/dist/docs/` for any
version-specific testing guidance before assuming a setup from training
data) — most likely Vitest for unit/action-level tests. Write smoke tests
against **already-stable, unlikely-to-churn code** so this task doesn't
depend on Wave 1's other in-flight features: `src/lib/i18n/format.ts`
(`format`/`plural`), `src/lib/session.ts`'s cookie-fallback logic, and the
Zod schemas in `src/lib/actions/auth.ts` / `src/lib/actions/household.ts`.

**Database caution**: don't run tests that mutate data against the shared
dev Postgres carelessly — either point tests at a separate test database
(a second `docker-compose` service, or a `DATABASE_URL` override) or scope
any DB-touching tests to wrap each test in a transaction that's rolled
back. Pure-function tests (schemas, `format`/`plural`, `getStockStatus`,
`isNavItemActive`) don't need a database at all — start there.

**Primary files**: new `vitest.config.ts` (or equivalent), new `*.test.ts`
files colocated with what they test (or a `src/**/__tests__/` convention —
pick one and document it in REQUIREMENTS.md), `package.json` (add the
`test` script + devDependencies).

**Shared files**: `package.json` (adding scripts/devDependencies here is
usually a clean, low-conflict diff — but if two Wave-1 tasks both add
dependencies, resolve by keeping both).

**Out of scope**: don't try to test Wave 1's other in-flight features
(meal planning, budgeting, profile) — they don't exist yet on this branch.
Follow-up tasks should add their own tests alongside their own feature
work once this task's framework has landed.

### 5. Household lifecycle follow-ups (ownership transfer, leave, invite email)

Bundled into one task, not split further, because both pieces touch
`src/lib/actions/household.ts` — splitting them across two parallel agents
would guarantee a same-file merge conflict for no real benefit.

**Goal, part A — ownership transfer / leaving a household you don't own**:
today `deleteHouseholdAction` refuses to delete a household if it's the
owner's only one, and there's no way for a `CONTRIBUTOR` to leave a
household, nor for an `OWNER` to hand off ownership before leaving. Add:
a `leaveHouseholdAction` for contributors (removes their own membership;
mirrors `removeMemberAction`'s shape but self-targeted, and must still
enforce "can't leave your only household"), and a
`transferOwnershipAction(newOwnerMemberId)` for the current owner
(swaps `OWNER`/`CONTRIBUTOR` roles between the caller and the target member
in a `$transaction`, same pattern as `removeMemberAction`/
`deleteHouseholdAction`). Wire both into
`src/app/dashboard/household/page.tsx` / `member-list.tsx`, gated the same
way the existing danger zone is (owner-only for transfer; every member sees
their own leave option, but the owner's row shouldn't show "leave" — they
transfer or delete instead).

**Goal, part B — email delivery for invites**: `createInviteAction`
currently only returns the join URL for the inviter to copy/send manually.
Add real email delivery (pick a provider — Resend is the least-friction
choice for a Next.js app, but check for an existing preference before
assuming; needs a new env var, documented in `.env.example`). Keep the
on-screen link as a fallback/copy option even once email sends — don't
remove that UX, just add sending on top of it.

**Primary files**: `src/lib/actions/household.ts`,
`src/app/dashboard/household/page.tsx`,
`src/components/household/member-list.tsx`, new
`src/lib/email.ts` (or similar), `.env.example`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts`.

## Wave 2 — start after the Wave 1 tasks they depend on have merged to `main`

### 6. Cost analyzer

**Depends on**: Task 2 (Budgeting UI) merged to `main` — this lives as a
section/tab on the Budget page rather than a new top-level route (adding a
new `nav-items.ts` entry isn't needed and would be an extra conflict
surface for no reason).

**Goal**: surface grocery cost trends from `PriceHistory` (already
populated whenever a shopping list item is marked purchased with an
estimated price — see `togglePurchasedAction` in
`src/app/dashboard/shopping-list/actions.ts`). At minimum: spending over
time (e.g. a per-month total), and price trend per item where there's
enough history to be meaningful. Use the existing `--chart-1..5` tokens
(already defined for this purpose in `globals.css`) for any charting —
pick a lightweight charting approach; don't pull in a heavy dependency
without checking what's already installed.

**Primary files**: new `src/components/budget/cost-analyzer.tsx` (or
similar, inside the budget feature area established by Task 2), wired into
`src/app/dashboard/budget/page.tsx`.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` (extend `budget`
namespace).

### 7. Shopping-list → budget expense link

**Depends on**: Task 2 (Budgeting UI) merged to `main` — needs the
"Groceries" category lookup/helper it establishes.

**Goal**: when a shopping list is completed (`completeShoppingListAction`
in `src/app/dashboard/shopping-list/actions.ts`), create a "Groceries"
expense `Transaction` for the total of purchased items' `estimatedPrice`
(only items that have one — don't invent prices). Use Task 2's
find-or-create-category helper rather than duplicating that lookup.

**Primary files**: `src/app/dashboard/shopping-list/actions.ts` (extend
`completeShoppingListAction` — this file was last touched by Phase 1's
multiple-shopping-lists work, so re-read it fresh rather than assuming its
shape from memory), reads from whatever Task 2 exported.

**Shared files**: `src/lib/i18n/dictionaries/{en,sv}.ts` if any new
user-facing text is needed (e.g. a confirmation that an expense was
logged).

**Out of scope**: don't add a settings toggle to turn this off unless
asked — REQUIREMENTS.md describes it as the intended default behavior, not
optional.

## REQUIREMENTS.md subsection convention

Each task appends its own new `##`-level (or nested `###` under an
existing `##`) subsection describing what it built, in the same voice and
level of detail as the existing sections — see how "Multi-tenancy model"
documents *why* things work the way they do, not just what the code does.
Move the corresponding line out of "Not yet built" once the feature lands.
Don't rewrite sections you didn't build.
