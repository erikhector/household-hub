# Backlog

The single list of open work for Squirrel. Everything here is **not built
yet**; everything already shipped is documented in
[REQUIREMENTS.md](./REQUIREMENTS.md), and the planning docs that produced it
are kept for their design rationale in [`docs/archive/`](./docs/archive/)
(code comments still cite them by item).

**Picking an item:** one `MAINT-` item titled `Flaky: …` goes first,
then `UX-` items, whatever their phase (see AUTOPILOT.md, "What the
builder may pick"). Otherwise take the lowest phase you can. Within Phase 1, anything
can run in parallel except the file conflicts listed at the top of that phase. Phase 2
items each add a Prisma migration, so land them **one at a time**, each
rebased on the previous one's merge, to avoid migration-ordering conflicts.
Phase 3 items are large enough to deserve their own PR. The last section
needs a product decision before anyone builds anything: the
`autopilot-product` routine takes the ones AUTOPILOT.md delegates to it
and leaves the rest for the owner (see PRODUCT.md).

**Finishing an item:** document what shipped in the relevant REQUIREMENTS.md
section (as every feature so far has), then **delete the item from this
file** rather than ticking it — this file only ever holds open work. If a
design rationale is worth keeping beyond REQUIREMENTS.md, cite the ID in the
commit message.

Status legend: `[ ]` not started · `[~]` in progress · `[!]` blocked / needs
a decision.

IDs are prefixed by area so they stay stable as items move between phases:

| Prefix | Area | Origin |
|---|---|---|
| `AUTO-` | Shopping list & inventory automation — "make it feel like magic" | `docs/archive/AUTOMATION_BACKLOG.md` (design review, Sep 2026) |
| `SCALE-` | Performance, scale and security | `docs/archive/SCALABILITY_BACKLOG.md` (2026-09-15 review) |
| `BUDGET-` | Collapse `personal-budget/` components into the household ones | `docs/archive/PERSONAL_BUDGET_UNIFICATION.md` (design spike) |
| `PRICE-`, `TASKS-`, `INFRA-` | Open product decisions | `docs/archive/UX_FRICTION_BACKLOG.md`, `docs/archive/JOY_GAP_BACKLOG.md`, REQUIREMENTS.md |
| `GAP-` | Feature gaps vs. competing household/grocery/budget apps (AnyList, Bring!, Grocy, Listonic, Splitwise, Cozi, …) | recurring daily competitive scan, logged as dated entries below |
| `SEC-`, `PERF-`, `MAINT-` | Security, performance and maintainability | Three-way code audit, 2026-09-26 (this file is the only record) |
| `UX-`, `BUG-`, `DEPS-` | UX problems, production errors, dependency upgrades | Autopilot scouts (see AUTOPILOT.md); `SEC-`/`PERF-`/`MAINT-`/`GAP-` scouts reuse those prefixes |
| `MATCH-` | Recipe ingredient → inventory matching review, aliases, unit conversions | [`docs/archive/RECIPE_INGREDIENT_MATCHING.md`](./docs/archive/RECIPE_INGREDIENT_MATCHING.md) (design, 2026-09-27) |

Before any item: run lint → typegen → tsc → test → build (see AGENTS.md)
before calling it done, and add every new user-facing string to both
`en.ts` and `sv.ts`.

---

## Guardrails

**For every item:** everything in AGENTS.md's Conventions still applies —
`requireHousehold()` tenancy, no household id from the client, i18n in both
dictionaries, new browser storage goes through `cookie-inventory.ts`.

**For `AUTO-` items** — these came out of the automation review and
constrain *how* each one is built. The goal is to minimize how often a
household member has to type anything at all:

- **Suggest, don't silently mutate.** Anything that changes an inventory
  quantity or money (a `Transaction`, a `PriceHistory` row) is either an
  explicit user action or a one-tap-to-accept suggestion — never an
  invisible side effect. This is the same reasoning "Mark meal as cooked"
  uses in REQUIREMENTS.md for not auto-decrementing from the calendar.
  Filling in *defaults* on a row the user is about to save (a category, a
  unit, a price, an estimated expiry) is fine; changing stored numbers
  behind their back is not.
- **Every automation is correctable, and corrections stick.** If the app
  guesses a category/unit/shelf-life and the user changes it, that choice
  wins from then on for that item — the app never re-guesses over a human
  correction.
- **Undo over confirm.** Prefer doing the likely thing immediately with an
  "Undo" on the toast (the `MarkCookedDialog` pattern) over a confirmation
  dialog up front. Confirmation dialogs are for destructive, hard-to-undo
  actions only.
- **Works with no AI key configured.** Anything using the Gemini/Anthropic
  chain (`src/lib/actions/inventory-scan.ts`'s `resolveAttempts`) must have
  a deterministic, keyless path that still removes most of the typing. AI
  is the long tail, not the foundation. Any new AI call sends the minimum
  data needed (item names only — never quantities, prices or household
  info), is rate-limited per household with `checkRateLimit`, and is
  disclosed the same way AI shelf scan's is.
- **Predictions stay out of the bell.** Suggestions ("you usually buy
  coffee about now") live *inside* the shopping list as dismissible chips,
  not as notifications — the Joy Gap backlog's rule that a bell badge must
  mean something is actually wrong still applies.
- **Nothing new in the browser without the inventory.** Any new cookie/
  localStorage key goes through `src/lib/cookie-inventory.ts` (AGENTS.md).
  Prefer server-side storage for anything learned, so it's shared across a
  household's devices anyway.

Also carried over from the Joy Gap memo: no streaks or loss-aversion on
money, no member-vs-member leaderboards, and positive notifications stay rare
enough to trust.

---

## Phase 1 — independent, no schema changes

Parallel-safe except where noted.

### Security hardening (2026-09-26 audit)

Tenancy held up everywhere the audit traced it (every client id is scoped by
`householdId`/`userId`); these are the gaps around it, highest severity first.

- [ ] **SEC-12. Dependency hygiene** (low) `[!]` — blocked on upstream.
      `prisma` is already a devDependency; `npm audit --omit=dev` still
      shows 4 high findings (`mysql2`, `deepmerge-ts` via `@prisma/config`)
      because `@prisma/client` lists `prisma` as an optional peer, which npm
      installs and audits. Not reachable at runtime (details in
      REQUIREMENTS.md, "Dependency audit findings (SEC-12)"). Nothing to do
      until Prisma ships patched versions: re-audit on the next Prisma bump
      and delete this item then. `next-auth` is still `5.0.0-beta.32`; track
      its advisories. Pairs with MAINT-12's Dependabot config.

### Performance (2026-09-26 audit)

Bundle numbers are First Load JS gzipped, measured from a production build:
shared root 206 KB; meal-planning 472 KB; shopping list 445 KB; inventory
395 KB; budget 390 KB; home 335 KB; login 260 KB.

- [ ] **PERF-13. Make the notification-sync cron proportional to work, not households** (low now, M) —
      `api/cron/sync-notifications/route.ts:41-65` walks every household in
      sequential batches of 10, with no `maxDuration`. Pre-select only
      households with candidates (one query per trigger), export
      `maxDuration`, and log run duration.

- [ ] **PERF-18. Batch "Add to shopping list" from inventory** (low, S) —
      `addToShoppingListAction` (`src/app/dashboard/inventory/actions.ts:671-683`)
      accepts up to 200 ids (`addToListSchema`, line 652) and loops
      `addItemToDefaultList` (`src/lib/shopping/default-list.ts:90-122`),
      which does `getOrCreateDefaultShoppingList` + `findFirst` + `create`
      per item: up to ~600 sequential round trips for a select-all bulk add,
      against a remote Postgres. PERF-15 already built the fixed-query
      pattern in `addToDefaultListOnLowStockBatch` (`default-list.ts:198`).
      Resolve the list once, read the already-pending `inventoryItemId`s in
      one query, `createMany` the rest, keep the same
      `{ listName, added, alreadyOnList }` result and the single-item path.
      Acceptance: a unit test asserts the query count is constant for 1 vs
      200 items, plus the existing dedupe (item already pending is counted
      in `alreadyOnList`); the existing inventory bulk-add e2e still passes.

### Maintainability (2026-09-26 audit)

Baseline at audit time: lint clean, `tsc` clean, 104 test files / 1,860
tests passing, no `any`/`@ts-ignore` in app code. Items 3, 6 and 7 all
touch `shopping-list/actions.ts` — land MAINT-2 → MAINT-6 → MAINT-3,
then MAINT-7 per feature, to avoid churn.

- [ ] **MAINT-3. Split `shopping-list/actions.ts`** (medium, L) — 2,114
      lines / 29 exports, test file 2,850 lines. Follow the meal-planning
      precedent: `list-`, `item-`, `smart-add-`, `purchase-` (toggle,
      put-away), `receipt-` and `store-order-actions.ts`, tests split the
      same way. Do after MAINT-2/5/6.
- [ ] **MAINT-6. Consistent error handling in Server Actions** (medium, M) —
      ~24 writing actions have no try/catch/`toFriendlyError`, so a raw
      error hits the error boundary: `planner-actions.ts` (add/update/move/
      delete entry, copy/undo-copy week — e.g. `:65-88`), `recipe-actions.ts`
      (create/update/delete/favorite), `lib/actions/push.ts` (all 4),
      `notifications.ts` dismiss/dismiss-all, `updatePasswordAction`,
      shopping link/unlink/apply-receipt/complete,
      `addMissingIngredientsToShoppingListAction`. Consider a
      `withFriendlyErrors` wrapper in `src/lib/actions/errors.ts`.
- [ ] **MAINT-7. Translate the remaining server-returned error messages**
      (medium, M, one PR per feature) — UX-16 added `dict.errors`, `fail()`,
      `zodFail()` and `v()` (`src/lib/actions/errors.ts`, see
      REQUIREMENTS.md "Internationalization") and converted shopping list,
      inventory, meal planning, tasks and the shared list link. Still
      English: the ~125 string-literal `error:` values and Zod messages in
      the files on `PENDING` in `src/lib/actions/error-strings.test.ts`
      (budget 35, household 27, personal budget 19, auth 14, barcode,
      receipt and inventory scans, profile, push, digest, household notes),
      plus `lib/recipe-import.ts`, `lib/email.ts`, `parse-import-csv.ts`,
      `savings-goal-calc.ts` and `budget-category-limit.ts`. Convert a
      feature at a time, add its keys to `dict.errors` (or a feature
      namespace, as `template-actions.ts` does), and delete the file from
      `PENDING`: the test fails if a clean file stays listed. Leave budget
      until BUDGET-6 is decided.
- [ ] **MAINT-8. One tested AI provider chain** (medium, M) —
      `resolveAttempts`/`callGemini`/`callAnthropic`/deadline-fallback loop
      is copy-pasted in `lib/actions/inventory-scan.ts:247-480`,
      `lib/actions/receipt-scan.ts:164-390` and
      `lib/inventory/ai-category-fallback.ts:107-228`, and none of it has
      tests. Extract `src/lib/ai/provider-chain.ts`, parameterised by prompt
      and response schema; unit-test fallback, busy and deadline paths with
      mocked `fetch`.
- [ ] **MAINT-10. Split oversized UI files** (low, M) —
      `components/shopping/shopping-list-client.tsx` (1,095 lines: move
      `ShoppingRow`, `PriceTag`, `PrintableList`, `ClearedState` out, pull
      state into hooks); `dashboard/budget/page.tsx` (967 lines:
      `BudgetTabsSection` runs 10+ queries inline — extract a
      `loadBudgetTabsData()` into `src/lib/budget/`). Budget part conflicts
      with PERF-12 and BUDGET-5/6.
- [ ] **MAINT-12. CI and tooling gaps** (medium, M, own PR — touches `package.json`/lockfile) —
      add a migration drift check to `.github/workflows/ci.yml` (Postgres
      service → `prisma validate` → `migrate deploy` → `prisma migrate diff
      --from-migrations prisma/migrations --to-schema-datamodel
      prisma/schema.prisma --exit-code`; a dropped-column migration already
      caused the PR #36 outage); add Dependabot/Renovate config; pin Node
      via `engines` + `.nvmrc` and `node-version-file` in the 3 workflows;
      optionally `npm audit` and `knip`. ESLint 9 is flagged unsupported by
      `npm ci` — bump to ESLint 10 + matching `eslint-config-next` in a
      separate PR.
- [ ] **MAINT-13. Fix documentation drift** (low, S) — REQUIREMENTS.md
      says react-hook-form is installed (it isn't, `:37-39`); its "Testing →
      What's covered so far" section cites a missing `AGENT_TASKS.md` and
      calls meal planning/budget/profile untested (they're well tested);
      comments in `budget/actions.ts:18-35`, `lib/notifications.ts:16,63`,
      `meal-planning/cookable-recipes.ts:77`, `shopping-list/actions.ts:519`
      cite a `findOrCreateInventoryItem` that no longer exists. Delete the
      stray committed `src/components/budget/cost-analyzer.tsx.orig`, and
      add `*.orig` and `*.rej` to `.gitignore` so a conflict leftover
      can't be committed again.
- [ ] **MAINT-15. Remove dead exports and tighten types** (low, S) —
      exported-but-internal `isValidQuietHour` (`lib/quiet-hours.ts:37`),
      `loadHouseholdDigestInput`, and unused constants (`PRICE_SPIKE_MIN_*`,
      `CALENDAR_FEED_*_DAYS`, `MAX_LEFTOVER_SERVINGS`, `SWISH_*`); non-null
      assertions in `lib/rate-limit.ts:97,100`, `tasks/page.tsx:38`,
      `push-notifications-card.tsx:98`, `lib/push.ts:21`; replace
      `v as MealType`-style `onValueChange` casts (16 in `inventory-client.tsx`)
      with a typed `isOneOf(values)` guard.
- [ ] **MAINT-16. Test the untested safety-critical helpers and actions** (medium, S) —
      no test file exists for `lib/logger.ts` (its `redact()` is the only
      thing stopping a careless `logger.error("x", { user })` leaking a
      password or token into Sentry/logs: sensitive-key match, nested
      objects, arrays, `Error` instances, circular refs), nor for
      `lib/actions/notifications.ts` (`dismissNotificationAction` /
      `dismissAllNotificationsAction`: tenancy via `requireHousehold()`, an
      id from another household is a no-op), `lib/actions/preferences.ts`
      (invalid theme ignored, DB failure logged not thrown) or
      `lib/actions/locale.ts`. AGENTS.md requires a colocated test for every
      Server Action. Acceptance: four new `*.test.ts` files that fail if the
      household scope or a redaction pattern is removed.
- [ ] **MAINT-17. One local-date `YYYY-MM-DD` helper** (low, S) — the same
      timezone-offset dance (`new Date(d.getTime() - d.getTimezoneOffset() *
      60000).toISOString().slice(0, 10)`) is copy-pasted as
      `toDateInputValue` in `components/budget/transaction-dialog.tsx:121`
      and `personal-budget/log-shared-expense-dialog.tsx:82`, and as
      `todayInputValue` in `components/budget/household-balances.tsx:73`,
      while `meal-planning/date-utils.ts` has a UTC `toDateKey` with the
      opposite semantics under a similar name. Add `toLocalDateKey` /
      `todayLocalDateKey` to a shared `src/lib/` module with a unit test
      around midnight in a non-UTC offset, use it in the three call sites,
      and note in `toDateKey`'s comment that it is UTC. Acceptance: no
      behaviour change; the test covers 23:30 local in UTC-5 and UTC+10.
- [ ] **BUG-5. Re-land #336 ("what's left to split") with its spec passing in the full gate** (medium, S) —
      #336 (`feat: show what's left to split as shares are typed`) turned
      `next` red and was reverted by #340, which also deleted
      `e2e/split-remainder.spec.ts`. Its spec failed at `:31` and `:57`
      (`mobile`, a `locator.fill` timeout; also `desktop` on a feature
      branch) in the local `ci:local` gate on a clean `0444ce1` (2026-10-18,
      780 passed, 3 failed) and in 3 of 3 full runs on the UX-82 branch
      (#343), yet passed alone (`--repeat-each=3`, 14/14), so it depended on
      something earlier specs leave in the worker's household or on a field
      it didn't wait for. Re-apply #336 (revert #340), find why the share
      field can't be filled in the full run and fix the spec's setup
      (AGENTS.md "Parallel workers") or the app, never a skip or looser
      assertion, and restore #336's REQUIREMENTS.md text. Acceptance: the
      full `npm run test:e2e` passes with the re-landed
      `e2e/split-remainder.spec.ts`, and `npx playwright test
      e2e/split-remainder.spec.ts --repeat-each=10` passes.
- [ ] **MAINT-34. Flaky: "Copy last week" menuitem not visible in meal-planner-empty-slots** (low, S) —
      `e2e/meal-planner-empty-slots.spec.ts:76`, `mobile` project. Failed
      once in the local `ci:local` gate on MAINT-27 (`b4cc843`, 2026-10-19):
      the "Copy last week" menuitem was not visible after clicking More. It
      passed 42/42 alone (`--repeat-each=10`) and in the next full gate on
      the same commit, so it depends on load, probably a click before
      hydration like MAINT-27. Fix it in the app (when the More menu is
      interactive) or in the test's waiting, never a loosened assertion, a
      skip or a retry. Acceptance: `npx playwright test
      e2e/meal-planner-empty-slots.spec.ts --project=mobile --repeat-each=30`
      passes 30/30.
- [ ] **MAINT-35. Flaky: `planner-add-missing` hits a duplicate `MealPlan` week key on mobile** (low, S) —
      `e2e/planner-add-missing.spec.ts:76` and `:82`, `mobile` project.
      Failed in one local `ci:local` gate on the UX-129 branch (`cd0514d`,
      2026-10-19) with a unique-constraint error on
      `MealPlan_householdId_weekStartDate`; the next full gate on the same
      commit passed. The spec creates the week's plan with a plain insert
      while the app can create it first. Fix it in the spec's setup (upsert
      or reuse the existing row) or in the waiting, never a loosened
      assertion, a skip or a retry. Acceptance: `npx playwright test
      e2e/planner-add-missing.spec.ts --project=mobile --repeat-each=30`
      passes 30/30.
- [ ] **MAINT-38. Flaky: item page back arrow doesn't reach the item heading from the recipe sheet** (low, S) `[!]` —
      `e2e/item-page.spec.ts:139`, `mobile` project. Failed in the local
      `ci:local` gate on release PR #448 (`aec8755`, 2026-10-20): after
      clicking the flour ingredient link in the recipe sheet (line 173),
      `getByRole("heading", { name: "Flour …", level: 1 })` was not found
      within 5 s. Passed on a re-run of the same spec on the same commit,
      and the GitHub e2e job was green. Find why the item page can be slow
      to show its heading after that navigation and fix it in the app or
      the spec's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/item-page.spec.ts:139
      --project=mobile --repeat-each=30` passes 30/30.
      Investigated 2026-10-20, not fixed: it does not reproduce (30/30 and
      40/40 on the production build, 3 workers, also with 2 busy CPU loops
      beside it). The server is not the slow part: the item page's RSC
      request answers in 10 to 200 ms. The wait is client-side (route
      chunk, hydrating the item page's client tree): click to heading is
      0.15 to 1.2 s normally, 1 to 2.9 s with Chromium's CPU throttled 8x
      and 2.5 to 3.5 s at 25x, so a loaded `ci:local` gate (3 browsers, a
      build and sibling worktrees on one box) can cross the 5 s default.
      No dialog-history `back()` runs on this path (checked by logging
      history calls), so it is not a history race. Needs a decision, since
      every honest fix changes the budget or the page: (a) give post-
      navigation heading waits in this spec a longer explicit timeout (a
      loosened wait, which this item's rules forbid unless the Owner
      allows it), or (b) restructure the item page so the heading and back
      arrow render before the eight queries and the controls' client tree
      (a Suspense split, larger than S).
- [ ] **MAINT-39. Flaky: shopping-item glide shows a layout shift of 0.0119** (low, S) —
      `e2e/motion.spec.ts:180` ("adding, ticking and removing shopping
      items glide, with no layout shift"), `desktop` project. Failed in the
      local `ci:local` gate on release PR #470 (`edc55ea`, 2026-10-20):
      CLS 0.0119 against an expected 0, on three shopping-item swipe rows.
      Passed on a re-run of `e2e/motion.spec.ts --project=desktop` on the
      same commit (8/8), and the GitHub e2e job was green. Seen again in
      the `ci:local` gate on PR #464 (`815c9ca`, 2026-10-20): CLS 0.012,
      passed 14/14 on a re-run on the same commit. Find what shifts
      the swipe rows under load and fix it in the app or the spec's
      waiting, never a loosened assertion, a skip or a retry. Acceptance:
      `npx playwright test e2e/motion.spec.ts:180 --project=desktop
      --repeat-each=30` passes 30/30.
- [ ] **MAINT-40. Flaky: all-caught-up card test still sees an open task checkbox after reload** (low, S) —
      `e2e/task-caught-up.spec.ts:77` ("with nothing open, a fresh visit
      shows the all-caught-up card above Completed"), `desktop` project.
      Failed its first attempt in the GitHub `End-to-end (Playwright)` job
      on release PR #477 (`d16c164`, 2026-10-20) and passed on the retry.
      The assertion at line 91, after `page.reload()`, expected
      `getByRole("checkbox", { name: /^Mark .* as done$/ })` to have count 0
      but received 1 for the whole 5 s. Also failed on the `mobile`
      project in the `ci:local` gate on PR #464 (`fc00440`, 2026-10-20),
      where another open task appeared in the worker's household mid-test,
      and passed on re-runs of the same commit. Find which task is still
      open after the spec's own completions (a late write, or another row
      in the worker's shared household) and fix it in the app or the
      spec's setup and waiting, never a loosened assertion, a skip or a
      retry. Acceptance: `npx playwright test
      e2e/task-caught-up.spec.ts:77 --repeat-each=30` passes 30/30 on
      both the `desktop` and `mobile` projects.
- [ ] **MAINT-41. Flaky: shopping tick moment can't find the checked row** (low, S) —
      `e2e/tick-moment.spec.ts:96` ("ticking a shopping row buzzes 10 ms,
      springs, then moves the row to the cart"), `desktop` project. Failed
      in the local `ci:local` gate on release PR #477 (`d16c164`,
      2026-10-20): `toBeChecked()` then "element(s) not found". Passed on a
      re-run of the whole spec on the same commit (10/10), and the GitHub
      e2e job was green. Find what makes the row disappear or re-render
      before the assertion under load and fix it in the app or the spec's
      waiting, never a loosened assertion, a skip or a retry. Acceptance:
      `npx playwright test e2e/tick-moment.spec.ts:96 --project=desktop
      --repeat-each=30` passes 30/30.
- [ ] **MAINT-42. Flaky: bottom-bar label check can't find "More" while it carries an unread badge** (low, S) —
      `e2e/navigation.mobile.spec.ts:85` ("the bottom bar labels are at
      least 12 px"), `mobile` project. Failed in the local `ci:local` gate
      on PR #464 (`6c00cff`, 2026-10-20): the More button read "1 More"
      (an unread-notification badge left by another spec in the worker's
      shared household), so `nav.getByText("More", { exact: true })` found
      nothing. Passed on a re-run of the whole spec on the same commit
      (8/8). Make the spec independent of other specs' notifications (its
      own household state, or a locator for the label element itself that
      still asserts its exact text), never a loosened assertion, a skip or
      a retry. Acceptance: `npx playwright test
      e2e/navigation.mobile.spec.ts:85 --project=mobile --repeat-each=30`
      passes 30/30.

### UX (2026-09-26 scout)

Found by loading every dashboard route at 390×844 and 1280×800, in English
and Swedish (which needed the seeded user's `locale` set in the DB — the
`locale` cookie is only a fallback for signed-out pages, per
`get-dictionary.ts`'s comment). No console errors, no untranslated strings,
no broken empty states — the issues below are all clipped/illegible text.

### UX (2026-09-30 scout)

Found by reading the mobile (Pixel 7) and desktop `en`/`sv` screenshots from
`npm run test:e2e:screenshots`. All 102 smoke/public tests pass, so these are
judgement calls, not failures.

### UX (2026-10-04 production-readiness audit)

A full design audit of every page and every dialog, menu and popover:
- 352 screenshots: Pixel 7, iPhone SE (1st gen) 320×568, Android 360×740, phone
  landscape 863×393, iPad portrait 810×1080 and desktop, in dark and
  light, en and sv, and at 200% text.
- A probe for overflow, clipped text, tiny text and sub-16px fields.
- 198 popups opened and closed with Escape.
- A code read of `src/components/**` against DESIGN.md.

The smoke suite passes. Every item below is something it doesn't
measure, and each was confirmed in a screenshot or in code (file:line).
Full report with screenshots: [Squirrel UI audit](https://claude.ai/artifact/FW6gUZ7NeMtTPVV15YwN2j).

**File conflicts.** Several items touch the same shared primitives, so
don't build these in parallel:
- `ui/dialog.tsx`: UX-11, UX-12

- [ ] **UX-30. Decimal comma in number fields on iOS** `[verify on device]`
      (high if it reproduces, S) — There are 48 `type="number"
      inputMode="decimal"` fields, for example
      `transaction-dialog.tsx:319` and `quick-add-bar.tsx:102`. With a
      Swedish region, iOS's decimal pad offers only ",". WebKit has
      treated "12,5" in a number input as invalid and submitted `""`.

      Test on a Swedish-region iPhone. If it reproduces, switch money and
      quantity fields to `type="text" inputMode="decimal"` with a pattern,
      and normalise "," before Zod, reusing `item-units.ts:68`'s parser.

### UX (2026-10-15 full UI review)

The owner asked for an extensive review of every page, logged in and
logged out, with one goal: Squirrel should be fun to use and surprise
people with how good it looks and feels. How it was found:
- `npm run test:e2e:screenshots`: all 130 smoke/public checks pass.
- Seven reviewers each signed up a fresh household. They filled it
  through the UI with realistic data (long names, å/ä/ö) and used every
  page, dialog, menu and swipe in their area on a Pixel 7 first, then on
  desktop, in en and sv, light and dark.

Every item below was reproduced in a screenshot or confirmed in code
(file:line). Items already open elsewhere in this file were left out.

**Start here.** These items are broken or actively mislead people, so
build them first: UX-47,
UX-89.

**Built elsewhere.** Six items sit in other sections of this file:
- Phase 2, because they need a migration: UX-133 (task due dates) and
  UX-134 (budget month starting on payday).
- Needs a decision before building: UX-135, UX-136 and UX-138.

**File conflicts.** Don't build these in parallel:
- `src/components/shopping/shopping-list-client.tsx`: UX-49,
  UX-81, UX-85.
- `src/app/dashboard/page.tsx`: UX-69.
- `src/components/budget/transaction-dialog.tsx`: UX-111.
- `src/components/tasks/tasks-client.tsx`: UX-49, UX-106.
- `src/components/inventory/combo-field.tsx` and
  `src/components/ui/autocomplete.tsx`: UX-127.
- `src/components/meal-planning/week-planner.tsx`: UX-49.

#### Shell and cross-cutting

- [ ] **UX-49. Undo, not "This can't be undone", for everyday deletes**
      (impact: med, effort: M) — breaks Consistency and User control
      (DESIGN.md: "prefer undo for frequent, low-stakes actions"). On
      the same row, swipe → Delete removes the row with an Undo toast,
      while the visible trash or menu Delete opens a confirm saying the
      delete is permanent. Where:
      - tasks: `tasks-client.tsx:278-298`;
      - shopping items: `shopping-list-client.tsx:1301-1330`;
      - inventory ⋯ → Delete: `inventory-table.tsx:605-607`;
      - "Remove meal": `week-planner.tsx:581-585`;
      - Edit transaction → Delete stacks a second sheet;
      - deleting a recipe gives no toast at all.
      Archiving a shopping list is silent, with no toast and no undo
      (`shopping-lists-overview.tsx:139-170`), and its icon sits right
      next to the trash icon on every row.
      Acceptance: every delete path for a task, shopping item, inventory
      item, planned meal and transaction removes at once and shows the
      same Undo toast. Archiving a list shows "List archived · Undo".
      Archive and delete are no longer adjacent lookalike icons (for
      example, both behind a row ⋯ menu). Household, budget and account
      deletes keep their confirms.

- [ ] **UX-50. One empty-state pattern, with the next step inside it**
      (impact: med, effort: M) — breaks Consistency, Usability ("empty:
      explain and offer the next step") and M6. On a new household
      every section's empty state looks different:
      - Shopping ("No shopping lists yet. Create one to get started.")
        and Tasks ("No tasks yet — use Add task to add one",
        `tasks-client.tsx:106-108`) have no button inside them.
      - The planner shows seven identical "+ Add meal" cards, with no
        hint to add recipes first or use "Copy last week" / "Fill".
      - Cook now has no mascot and no action.
      - Meal prep's primary is an inline full-width bar, where the
        sibling tabs use the floating `PrimaryAction`.
      - The empty inventory offers five ways to add, three of them
        purple primaries, and the FAB covers its "Paste a list" link.
      - A new empty shopping list leads with a disabled full-width
        "Register receipt" above the add bar.
      Acceptance: every section and tab uses `MascotEmptyState` with one
      line on why it's worth using and exactly one primary action, placed
      through `PrimaryAction`. An empty week shows one empty state
      ("Add your first dinner" / "Fill the week") instead of seven
      slots. Nothing sits under the FAB at 412 px.

- [ ] **UX-52. Bottom bar: one icon style, and keep the colour on the
      active tab** (impact: low, effort: S) — breaks Consistency.
      - Inventory, Shopping and Meal planning have tinted icon tiles;
        Overview and More have plain icons.
      - The active tab drops its tile (`bottom-nav.tsx:125-127`), so the
        section colour (`nav-items.ts`, "recognise the screen by colour")
        disappears on exactly the screen you're on.
      - "More" has no tile, so its label sits higher than the other
        four.
      Acceptance: all five tabs share one icon treatment and their
      labels sit on one baseline. The active tab keeps its section hue,
      and that hue also marks the page (for example the large title's
      accent or the empty-state ring), so the colour coding means
      something.

- [ ] **UX-53. One period switcher for weeks and months** (impact: low,
      effort: S) — breaks Consistency. The budgets switch months with
      bare chevrons around a large centred heading. The meal planner
      switches weeks with bordered square buttons on the left and a
      small date.
      Acceptance: the budget, personal budget and planner use one shared
      period switcher with the same placement, size and accessible names
      ("Previous month" / "Previous week"), plus a "This month" / "This
      week" jump when you're elsewhere.

#### Logged out, signup and invites

- [ ] **UX-59. Signup and login errors next to the field, keeping what
      was typed** (impact: med, effort: M) — breaks Usability ("inline,
      actionable errors next to the field") and Context.
      - A password mismatch wipes both password fields, drops focus to
        `<body>` and shows one generic line above the consent text,
        with no `aria-invalid` or `aria-describedby`
        (`signup-form.tsx:157`, `login-form.tsx:95`).
      - A short password or bad email only gets the browser's native
        bubble, in the browser's language.
      - The 8-character minimum is never shown up front.
      - "An account with that email already exists" offers no Log in or
        Forgot password link.
      Server-message translation is MAINT-7. Whether signup should stop
      revealing that an email exists is a security call, not part of
      this item.
      Acceptance: a mismatch keeps the first password, focuses Confirm
      password and shows the error under it with `aria-invalid`. The
      password field shows "At least 8 characters" before submit. The
      duplicate-email error links to Log in and Forgot password.

- [ ] **UX-61. Clearer steps from signup to first login** (impact: med,
      effort: S) — breaks Usability (fewer steps).
      - After submit, the card is still titled "Create your household".
        If the email send fails, a red warning shows inside it.
      - A valid verify link shows "Verify your email" (an instruction,
        not an outcome) and a small "Go to dashboard" link that bounces
        to an empty `/login`
        (`src/components/auth/verify-email-client.tsx:37-43`).
      - After a password reset, the login email field is empty too.
      Signing in straight from the link is UX-135.
      Acceptance: the post-signup card says "Check your inbox" and names
      the address. A good verify link says "Email verified" with a
      primary "Log in" that pre-fills the email. `/login?reset=success`
      pre-fills the email.

- [ ] **UX-62. A warm join page that says who invited you** (impact:
      med, effort: S) — breaks Consistency and the Squirrel voice. An
      invitee's first contact with Squirrel is a bare "Join {household}"
      form (`src/components/household/join-signup-form.tsx`). It has no
      brand badge, no inviter name, no line on what Squirrel is, and
      different field styling from `/signup`. An invalid invite offers
      "Back to log in" to someone who never had an account.
      Acceptance: the join page shows the BrandBadge, "{inviter} invited
      you to {household} on Squirrel", a one-line pitch and signup's
      field styling. The invalid-invite card offers "Go to Squirrel" and
      "Log in".

- [ ] **UX-63. The shared-list page as good as the member view**
      (impact: med, effort: M) — breaks Consistency and User-centricity
      (the person you share with is often the one in the shop).
      `/share/shopping-list/<token>` (`shared-shopping-list-client.tsx`)
      has:
      - a flat list in insertion order: no aisle grouping, progress ring,
        dock or All done;
      - no brand badge and no sharer;
      - an amber warning that ticks change "this household's actual
        shopping list and inventory" (`en.ts:3144`), which is jargon for
        a non-user;
      - `sharedShoppingList.footerNote` (`en.ts:3147`) defined but never
        rendered;
      - long names clamped to two lines, readable only in a `title`
        tooltip that phones can't show.
      Acceptance: the share page shows the brand badge and "Shared by
      {household}", groups by aisle in the household's store order, shows
      "n of m" progress and an All done state, and has a neutral one-line
      banner. Long names can be read in full, and a footer links to `/`.

- [ ] **UX-66. Legal pages in Swedish (or marked English), with an
      accurate "who we are"** (impact: med, effort: M) — breaks Context
      and Accessibility. ⚠️ Touches the privacy page (human-only area).
      - The sv cookie notice's "Läs mer" opens an English-only policy
        inside `<html lang="sv">`, so screen readers read English with a
        Swedish voice.
      - The policy says Squirrel "isn't a large multi-tenant SaaS company
        … it's a self-run app", which contradicts the public "Get started
        free" (`src/app/privacy/page.tsx:74-75`).
      - It is about 8,000 px long with no table of contents.
      Acceptance: sv serves Swedish legal text, or the English body
      carries `lang="en"` and an "Only available in English" note. "Who
      we are" matches how Squirrel is offered. The page starts with a
      jump list.

- [ ] **UX-67. Let password managers update the right login on reset**
      (impact: low, effort: S) — M4. `reset-password-form.tsx:25` has no
      username field, so Chrome and iOS offer to save a password with no
      account attached.
      Acceptance: the form includes a hidden `autocomplete="username"`
      input holding the account email.

- [ ] **UX-68. Landing calls to action are links, not buttons**
      (impact: low, effort: S) — breaks Accessibility (real `<a>`
      semantics). "Log in", "Get started free", "Create your household"
      and the 404's action render as `<a role="button">` through
      `Button render={<Link/>}`, so screen readers announce a button that
      navigates.
      Acceptance: these expose `role="link"`, and e2e finds them with
      `getByRole("link", …)`.

#### First run and the overview

- [ ] **UX-69. Getting started: ticked steps, progress, one prompt per
      feature, and a finish moment** (impact: med, effort: S) — breaks
      Hierarchy and M6, and misses a delight moment.
      - Finished steps vanish and the card silently disappears at the end
        (`src/components/dashboard/getting-started.tsx:50-51`).
      - "Track your personal budget" and the "Set up your personal
        budget" card (`src/app/dashboard/page.tsx:133,216-244`) sit
        stacked: two of the three blocks on the first screen push the
        same optional feature.
      - Meals, recipes and tasks have no step.
      - Rows have no chevron, and descriptions are 12 px (`:89`), below
        the 14 px floor.
      Acceptance: finished steps stay as ticked rows under an "N of M"
      progress bar. Completing the last step shows a short mascot "You're
      all set" moment once (no animation under reduced motion). The
      overview shows one call to action per feature. "Plan this week's
      meals" is a step. Descriptions are at least 14 px and rows show a
      chevron.

- [ ] **UX-73. New households get a currency from their language**
      (impact: med, effort: S) — breaks M4 (default what you can derive).
      `Household.currencyCode` stays null after signup
      (`prisma/schema.prisma:163`, no migration needed). Every amount in
      the budgets, shopping prices and recipe costs is a bare number
      ("+16,028.60", "→500.00") until someone finds the setting in the
      sixth card on the Household page. Money without a currency looks
      unfinished and less trustworthy.
      Acceptance: a household created in sv defaults to SEK, and in en to
      the browser region's currency where known. Budget onboarding shows
      it with one tap to change. A new household's safe to spend shows the
      symbol.

#### Profile and household settings

- [ ] **UX-77. Deleting your only household: explain instead of a button
      that refuses** (impact: low, effort: S) — breaks User control.
      ⚠️ Touches user-data deletion (human-only area). The red "Delete
      household" button is active, but tapping it opens "You can't
      delete your only household. Create another one first." The data
      export is named `household-hub-my-data-<date>.json`
      (`profile/export-data/route.ts:271`), after the repo, not the
      product.
      Acceptance: with one household the danger zone explains the rule
      inline and points to "Delete account". The export is named
      `squirrel-my-data-<date>.json`.

#### Shopping

- [ ] **BUG-3. A scanned receipt price isn't divided by its quantity**
      (impact: high, effort: M) — reported by the owner, 2026-10-18.
      A receipt line "3 x Mjölk 45,00" matched to a list row "Mjölk ×1"
      is saved as if one carton cost 45:
      - The scan reads the line's quantity (`ScannedReceiptLine.quantity`,
        `lib/actions/receipt-scan.ts:65`), but the review step drops it
        when building matches (`receipt-scan-dialog.tsx:306`), and
        `ReceiptScanMatch` has no quantity
        (`src/app/dashboard/shopping-list/actions.ts:1328`, the `actions.ts`
        cited below).
      - `applyReceiptScanAction` then writes PriceHistory with the list
        row's quantity (`actions.ts:1475-1480`, and via `applyStockArrival`),
        so the unit price is 45, not 15. GAP-9's price-spike check
        compares that inflated unit price.
      - `lastKnownPrice` becomes the line total (45), and every create
        path copies it into a new row's `estimatedPrice` without regard to
        quantity (`actions.ts:197,282,721,845`), so next week's "Mjölk ×1"
        is estimated at 45. `registerReceiptAction` has the same
        line-total problem (`actions.ts:1740-1760`).
      Acceptance: scanning "3 x Mjölk 45,00" against "Mjölk ×1" prices
      that row at 45 (what was paid) and records PriceHistory at 45 for 3
      (unit 15). The item's next estimate is 15 for ×1 and 30 for ×2, and
      no price-spike notification fires. Register receipt behaves the same.
      The review row shows the quantity and unit price ("3 × 15,00") so a
      misread can be caught. Stock still counts the list row's quantity,
      as today. A unit test on `applyReceiptScanAction` (and one on
      `registerReceiptAction`) fails without the fix, and the receipt e2e
      spec covers a ×3 line.

- [ ] **UX-140. Type prices in by hand when the receipt scan fails**
      (impact: medium, effort: M) — reported by the owner, 2026-10-18.
      Breaks User control and Error recovery.
      - When the photo can't be read (`noLinesFound`, `ocrError`, a
        provider error), `ReceiptScanDialog`'s only way forward is "Try
        again" with another photo (`receipt-scan-dialog.tsx:578-590`).
        Register receipt dead-ends the same way.
      - The per-row "Add price" on the list exists, but on a row already
        ticked as bought it only changes the row's estimate
        (`updateShoppingListItemPriceAction`,
        `src/app/dashboard/shopping-list/actions.ts:459`): it never
        becomes `lastKnownPrice` or a PriceHistory row, so a typed price
        counts for less than a scanned one.
      Acceptance: the scan's error state offers "Enter prices by hand"
      next to "Try again". It opens the same review step with one row per
      receipt-matchable list item (name, quantity, an empty price), and
      Apply records them exactly like scanned lines (PriceHistory,
      `lastKnownPrice`, `priceRecordedAt`, divided by quantity per BUG-3).
      Register receipt gets an "Add line" so a receipt can be typed in
      without a photo. New strings in `en.ts` and `sv.ts`; an e2e flow
      (AI mocked to fail) types a price and checks it after a reload, on
      desktop and mobile.

- [ ] **UX-81. A short, rewarding end to a shop** (impact: med, effort:
      M) — Delight, M4 and Hierarchy.
      - "All done" shows two buttons for the same thing: "Put away (15)"
        and "Put things away".
      - The put-away sheet is 15 cards, each with a three-way choice and
        quantity, best-before and location fields (about 4,500 px,
        `put-away-dialog.tsx:176-245`).
      - Every cart row has a "Not put away" badge mid-shop.
      - After completing, you're left on a struck-through read-only list.
      Acceptance: All done shows a one-line trip summary ("15 items · ≈
      240 kr · 18 min") and one primary "Put everything away" that
      accepts the defaults, with per-item details collapsed. No "Not put
      away" badges while the list is active. After completing, the page
      offers "Back to lists" and "Start next list".

- [ ] **UX-85. Rename a list, and start a new list from a template or a
      past list** (impact: med, effort: M) — breaks User control and M4.
      - Lists can't be renamed anywhere: there's no action in
        `shopping-list/actions.ts`.
      - The New list sheet asks only for a name.
      - Templates sit further down, each with its own "New list" button,
        so the page has two "New list" buttons that mean different
        things.
      - Repeating last week's shop means saving a template first; in
        Bring! and AnyList it's one tap.
      Acceptance: the list ⋯ menu (and tapping the title) offers Rename.
      The New list sheet offers "Start from: blank / a template / a
      recent list (unbought or all items)". Template rows say "Use".

- [ ] **UX-89. Typed list items don't turn into "out of stock" pantry
      items** (impact: high, effort: M) `[!]` — breaks User-centricity
      ("automation suggests, the user decides"). Needs a schema change and
      a decision: nothing records that an item was ever stocked or that a
      list row created it (only the current `quantity`), so "never
      stocked", "out" and "delete the item the row created" can't be told
      apart from a real used-up item without a new marker. Proposed: the
      `InventoryItem.everStocked` flag from UX-125 (build them together,
      one migration), plus an `InventoryItem.createdFromList` boolean set
      by the five list-side create paths; the overview, inventory
      "out" filter and OUT_OF_STOCK notifications skip items that are not
      `everStocked`, and `deleteShoppingListItemAction` removes a
      `createdFromList`, never-stocked item nothing else references.
      Decide: backfill `everStocked` for existing rows (see UX-125), and
      whether never-stocked items stay hidden from the "out" count or
      are not created at all until first stocked (bigger change: list rows
      would stay unlinked, `needsMapping`). Original report: Free-text list items
      silently create inventory items at 0 stock (`addAdHocItemAction`,
      `smartAddShoppingListItemsAction`). A household that only ever made
      lists sees "14 out of stock" on the overview: napkins, charcoal,
      crayfish, even the junk row from UX-88. Deleting the list row
      leaves the 0-stock item behind.
      Acceptance: a new household that only adds items to lists shows 0
      out of stock. Items that were never stocked, or are already on a
      list, don't count as out. Deleting a list row whose never-stocked
      inventory item it created removes that item too.

#### Meals and recipes

- [ ] **UX-96. The add-meal sheet names the day and can search recipes**
      (impact: med, effort: M) — breaks M4 and Context.
      - "Add a meal" never says which day, and the page behind is
        blurred.
      - The recipe field is a plain select whose popup shows about 1.5
        rows at the bottom of the sheet, with no search and no
        favourites-first order.
      Acceptance: the title reads "Add dinner · Mon 12". The recipe field
      filters as you type, lists favourites and recently cooked first, and
      shows at least 5 rows at 412 px.

#### Tasks

- [ ] **UX-106. Compact task rows, and a "Mine" filter** (impact: med,
      effort: M) — breaks M6 and Hierarchy.
      - Rows carry edit and trash icons as well as the swipe tray that
        already offers both.
      - With a long assignee name or Swedish recurrence text, the trash
        wraps to a third line, so about 4 tasks fit on a phone screen.
      - There's no way to see just your own tasks.
      Acceptance: at 412 px a one-line task with an assignee badge is at
      most 56 px, with edit and delete in the swipe tray and the edit
      sheet (M7: the edit sheet is the visible path). A "Mine / Everyone"
      filter is remembered.
      Re-landing note: #437 was reverted (#441) because
      `e2e/task-compact-rows.spec.ts:46` (`mobile`) failed on both attempts
      in the GitHub `End-to-end (Playwright)` job on release PR #440 (run
      39329747316): `row.getByText("E2E Tester", { exact: true })` not
      found in the task row, though it passed locally. Several builder
      gates failed it too, so it is not runner-specific. The new spec must
      pass in the GitHub e2e job; do not loosen the 56 px or name
      assertions.

- [ ] **UX-144. A repeating task's anchor day moves when it is edited**
      (impact: low, effort: S) — follow-up to UX-137, which anchors a
      weekly-or-longer chore on the day the task was created
      (`recurrence.ts`) because it shipped without a schema change. Editing
      the interval, or wanting "every Thursday" on a task made on a Monday,
      cannot move that anchor. Add a nullable `recurrenceAnchorAt` on
      `HouseholdTask` (one migration), set it when a task is created with
      an interval and whenever its interval is edited, and have
      `getNextDueDate` read it, falling back to `createdAt` when null.
      Acceptance: a unit test shows a weekly task whose anchor was reset
      keeps the new weekday after a late tick; an e2e step edits a weekly
      task's interval and asserts its next due follows the new anchor.

#### Budgets

- [ ] **UX-111. Split an expense evenly by default** (impact: med,
      effort: S) — bug, breaks Usability (sensible defaults). ⚠️ split
      (human-only area).
      - Typing 940 and ticking "Split this expense" shows both shares at
        0.00 with an instant red "The shares add up to 0.00…", and Add is
        disabled until "Split evenly" is found. The even split is
        computed from the amount when the dialog opens
        (`transaction-dialog.tsx:94`).
      - In "Log a shared expense" both Paid fields start at 0, though
        the person logging it nearly always paid.
      Acceptance: ticking Split with an amount shows an even split with
      no error. Shares follow the amount until edited. The current user
      is preselected as payer.

- [ ] **UX-112. A new member sees their shared costs before setting up a
      personal budget** (impact: med, effort: M) — breaks Context (never
      surprise a member) and Consistency. ⚠️ money.
      - After a partner splits a 940 dinner, the new member's personal
        Overview and home show only "Let's set up your budget". Their
        Transactions tab shows "Shared −470.00" and Insights says they owe
        470, but they'd never find either.
      - Their only action, "Log a shared expense", is an outline button
        at the top left.
      - The household page calls the same action "Add transaction" plus
        a "Split this expense" checkbox.
      Acceptance: a member with shared splits sees their share and what
      they owe or are owed on the personal Overview and home before
      adding categories. The shared-expense action has one name and
      placement on both pages.

- [ ] **UX-117. Safe to spend as a daily number, with a labelled pace
      chart** (impact: med, effort: S) — Delight, Hierarchy. Calm, with
      no mascot on money. The pace chart has only "Today" and "Month end"
      labels and no values. The daily question, "how much can I spend
      today?", isn't answered. Copilot Money and PocketGuard show a daily
      allowance.
      Acceptance: the card shows "≈ N per day for the D days left". The
      chart labels its Today and Month-end points with amounts. After an
      add, the headline animates through the existing `AnimatedNumber`.

- [ ] **UX-118. The "Due this period" card: right empty state, one Add
      placement** (impact: low, effort: S) — breaks Usability and
      Consistency.
      - With six recurring items, a past month says "Set up recurring
        bills and income to see what's due here"
        (`due-recurring-widget.tsx:177`).
      - Its ghost "Manage recurring items" reads like a stray label
        (`:172`).
      - On Manage, "Add recurring item" and "Add planned bill" sit under
        their descriptions while "Add category" sits top right.
      - The expanded safe-to-spend card repeats the Due list right above
        it.
      Acceptance: a month before the items existed says "Nothing was due
      this month". The three "Add …" buttons on Manage share one
      placement. The Due card's link looks like a link. Due items aren't
      listed twice.

#### Inventory

- [ ] **UX-125. Used-up items aren't labelled "never stocked"** (impact:
      med, effort: S) `[!]` — bug. Needs a schema change and a decision:
      nothing records that an item was ever stocked (no stock log; only the
      current `quantity`), so the fix is a new `InventoryItem.everStocked`
      flag, set wherever quantity goes above 0 (item form, +/- steppers,
      bought tick, receipt scan, bulk create, merge). Existing used-up items
      can't be backfilled from data: decide between backfilling `true` for
      every item with price history, bought rows or a non-default
      `lastKnownPrice` (partial), or accepting that already-empty items stay
      mislabelled until next restocked. Original report: The rule looks only at price history and
      bought list rows (`src/lib/inventory/duplicates.ts:60-62`), so items
      created with stock and then used up (Mellanmjölk, Laxfilé) are tagged
      "never stocked".
      Acceptance: an item ever saved with quantity > 0 is never listed
      under "Never stocked", with a unit test.

- [ ] **UX-126. Warn about a duplicate while adding, and offer "add to
      existing"** (impact: med, effort: M) — breaks Usability (prevent
      errors). Adding "smör" next to "Smör", or "Banan" next to "Bananer",
      saves a new item with no hint (`add-item-dialog.tsx`). The
      duplicate surfaces only later, needing a merge that "can't be
      undone", though "I bought more butter" is exactly when people reach
      for Add.
      Acceptance: when the typed name matches an existing item (the
      duplicates filter's check), the dialog shows "Smör is already in your
      pantry (499 g)" with a button to add the amount to it.

- [ ] **UX-127. Units in one tap on a phone** (impact: med, effort: M) —
      breaks M4 ("pick, don't type").
      - The unit field is prefilled "pcs" and its chevron is hidden while
        it has a value (`combo-field.tsx:50-55`,
        `ui/autocomplete.tsx:63-69`), so seeing other units means erasing
        "pcs" first.
      - Suggestions only include units the household already uses, so a
        new household gets none and has to type "dl" or "förp".
      Acceptance: one tap shows common units (st/pcs, g, kg, dl, l, förp)
      plus used ones, as chips or a list.

- [ ] **UX-128. Show a refused unit change next to the field** (impact:
      med, effort: S) — breaks Usability ("errors next to the field") and
      M5. Changing Smör from g to kg in Edit and tapping Save appears to do
      nothing: the refusal ("This item has stock… use Change unit…") is
      below the fold of the scrolling form, and the field stays editable.
      Acceptance: for an item with stock, the unit field is read-only with
      an inline "Change unit…" link, and any refusal shows beside it in
      view.

- [ ] **UX-131. A scannable item catalog on phones** (impact: low,
      effort: M) — breaks M6 and Consistency.
      - "All" shows ~130 px cards, three per screen, with no search, no
        stock badge and no sign that a card opens the item page.
      - The sort order differs from the inventory's (Ägg first here,
        last there).
      - In duplicate groups the radio/checkbox pair has no visible
        labels.
      Acceptance: the catalog has search and compact rows in the
      inventory's style and order. Duplicate rows show "Keep" / "Merge"
      labels.

### UX (2026-10-20 scout)

Tuesday area: shopping lists. Swept `desktop`, `mobile`, `landscape`,
`tablet`, `small-phone`, `light`, `text-200` and both dialog sweeps; every
route passes. The popup probe found two phone-only size gaps.

- [ ] **UX-143. Unit and item suggestions are 44 px tall on phones**
      (impact: med, effort: S) — M-rule break (44 × 44 targets). On the
      `dialogs-mobile` audit the suggestion rows in the unit pickers
      (`/dashboard/inventory/items/[id]` "Show suggestions": `pcs`, `g`,
      `dl` at 168×32) are 32 px high, because `AutocompleteItem`
      (`src/components/ui/autocomplete.tsx`, the `py-1.5 text-sm` row)
      lacks the `max-sm:min-h-11 pointer-coarse:min-h-11` that
      `ComboboxItem` (`src/components/ui/combobox.tsx:137`) already has.
      The same audit flags the combobox toggle (`ComboboxTrigger`,
      `combobox.tsx:56/71`) at 44×42 in "Merge into another item…", the
      shopping list's "Match item" (Inventory item) and personal-budget
      "Log a shared expense" (Category): `h-full` inside an `h-11` group
      loses 2 px to the border. Neighbouring suggestion rows are
      therefore easy to mis-tap in the shop, one-handed.
      Acceptance: in the `mobile` project, open the unit picker and the
      Match item dialog; every suggestion row and the combobox toggle
      measure at least 44 px in both dimensions
      (`getBoundingClientRect`), and `dialogs-mobile` reports no
      `smallTargets` for these.

- [ ] **UX-135. Sign in straight from the verification link**
      (impact: high, effort: M) — ⚠️ auth (human-only area). Login is
      blocked until the email is verified (`src/lib/auth.ts`) and signup
      deliberately doesn't sign in, so a new user taps the mail link and
      then types email and password again. A valid, unused verification
      token signs the user in (single use, short-lived, same trust as a
      reset link) and lands on the dashboard with "Welcome to Squirrel,
      {name}". An expired, used or unknown token keeps today's behaviour.
      Both `en.ts` and `sv.ts`; no new cookie.
      Acceptance: in an e2e spec, sign up, open the verification link
      (read the token from the DB), and land on `/dashboard` signed in
      with the welcome text; opening the same link again does not sign in.
      Decided 2026-10-20 by owner: option 1. See #395.

- [ ] **UX-138. "Safe to spend" subtracts what's still budgeted**
      (impact: high, effort: M) — ⚠️ money (human-only area).
      `src/lib/safe-to-spend-calc.ts` also subtracts the unspent
      remainder of limited categories, shown as its own "Still budgeted"
      breakdown line. The pace projection ("At this pace …") becomes a
      qualifier under the headline, not a second equally weighted "left"
      figure. Unit-test the calculator (day 1, partly spent, overspent
      category counts as zero remainder).
      Acceptance: with a seeded limited category and no spending, the
      headline excludes its limit, the breakdown shows "Still budgeted",
      and the projection reads as secondary text.
      Decided 2026-10-20 by owner: option 1. See #397.

### Dependencies

- [ ] **DEPS-2. Clear the transitive audit findings** (impact: med, effort: S) —
      `brace-expansion` (under `glob`), `sharp`, `source-map-js` (all high)
      and `fast-uri` (moderate) all have fixes available via
      `npm audit fix` or an `overrides` entry. Leave the Prisma-owned
      `mysql2`/`deepmerge-ts`/`@prisma/config` findings to SEC-12.
      Acceptance: `npm audit --omit=dev` lists only the SEC-12 findings;
      `npm run check && npm run build` is green.

- [ ] **DEPS-3. Bump patch/minor dependencies in one PR** (impact: low, effort: S) —
      `@base-ui/react` 1.8→1.9, `@sentry/nextjs` 10.73→10.76, `@upstash/redis`
      1.38→1.39, `@vercel/functions` 3.9→3.10, `lucide-react` 1.43→1.57,
      `pg` 8.23.0→8.23.1, `resend` 6.26→6.33, `shadcn` 4.21.0→4.21.5,
      `vitest` 5.0.0→5.0.4, `zod` 4.5→4.6, `@types/react(-dom)` 19.3, `@types/node`
      22.20.5. Skip the majors (Sentry 11, ESLint 10, TypeScript 7, React
      19.3 is fine to include if `check` passes); each needs its own item.
      Acceptance: `npm outdated` shows only majors; `npm run ci:local` green.

- [ ] **DEPS-4. Bump Next.js, Prisma and Playwright to their latest minors** (impact: med, effort: S) —
      DEPS-3 doesn't list the core stack: `next` and `eslint-config-next`
      16.4.0→16.4.2, `prisma`, `@prisma/client` and `@prisma/adapter-pg`
      7.10.0→7.10.1, `@playwright/test` 1.56→1.64. Keep them out of DEPS-3
      so a regression bisects to the framework. Read the Next 16.4 notes in
      `node_modules/next/dist/docs/` for changed APIs, and regenerate the
      client (`postinstall`). Playwright finds its browsers through
      `PLAYWRIGHT_BROWSERS_PATH` (the web image ships the Chromium build
      that matches 1.56, and `playwright install` is not allowed there), so
      check 1.64 still launches against it, or pin `executablePath` in
      `playwright.config.ts` if it doesn't.
      Acceptance: `npm outdated` no longer lists these; `npm run ci:local`
      is green on desktop and mobile.

- [ ] **DEPS-5. Upgrade `@sentry/nextjs` 10 → 11** (impact: low, effort: M) —
      Major release (10.73 installed, 11.8 latest). Sentry is wired into
      the client, server and edge configs plus `instrumentation`; check the
      v11 migration guide for removed options, then confirm an error still
      reaches Sentry with no PII added (see the privacy page).
      Acceptance: `npm run check && npm run build` green; the build emits
      no new Sentry warnings; REQUIREMENTS.md's monitoring section matches.

### Budget component unification

The data layer (Prisma models, both `actions.ts` files, both `page.tsx`
Server Components) stays separate by design — only the Client/presentational
components merge. See the archived spike for the full file-pair inventory and
the recommended "shared base + thin wrapper" shape.

- [ ] **BUDGET-5. Personal starter categories, then merge `BudgetOnboarding`/`PersonalBudgetOnboarding`**
      (impact: med, effort: M) — ⚠️ money surface. Give personal budget a
      short personal-oriented starter set (not the household one) offered
      through the same one-click `StarterCategoryPicker` as household
      onboarding, then merge the two onboarding components. Both
      languages. Keep the merge in the same PR only if it stays small;
      otherwise ship the set first.
      Acceptance: a fresh personal budget shows the starter picker; picking
      two categories creates them and the picker disappears.
      Decided 2026-10-20 by owner: option 1. See #398.

---

## Phase 2 — schema changes, one at a time

Each item adds a migration (`npx prisma migrate dev --name <name>`, local
only — production only ever runs `migrate deploy`). Land sequentially; the
order below is a suggestion, not a dependency, unless noted.

- [ ] **PERF-3. Add missing indexes** (medium, S) — one migration:
      - `HouseholdMember @@index([userId])`: `requireHousehold`
        (`src/lib/session.ts:69-78`) looks memberships up by `userId` on
        every dashboard request and Server Action, but the only index is
        `@@unique([householdId, userId])` with `userId` second → full scan
        that grows with total users.
      - `Transaction @@index([recurringTemplateId])`:
        `personal-budget-position.ts:227-230` filters by it without
        `householdId` (cross-household scan), and the template's
        `onDelete: SetNull` scans again on every delete.
      - `PersonalTransaction @@index([userId, date])`: needed by PERF-2.
      - Optionally `PriceHistory @@index([inventoryItemId, date])` for PERF-12.
      Verify with `EXPLAIN` before/after.
- [ ] **PERF-2. Month-scope the personal budget loader** (high, M; after PERF-3) —
      `src/lib/personal-budget-position.ts:62-66` reads *every*
      `personalTransaction` (with `category`), and `:106-118` every split
      household transaction before month end with nested member→user
      includes; it runs on every `/dashboard` home load
      (`dashboard/page.tsx:57`) and on `/dashboard/personal-budget`. Apply
      SCALE-F's household-budget pattern: month-scoped list/totals, a
      12-month lookback for rollover and the fixed trend
      (`personal-budget/page.tsx:217,330`), `groupBy` + `_sum` for all-time
      savings, and a SQL aggregate (`groupBy` on `TransactionSplit`) for
      "owed from earlier months". Verify with 3 years × 100/month seeded.
 No schema change of its own beyond PERF-3's index.

- [ ] **SEC-4. Removing a member revokes what they can still reach** (medium) —
      any role can create 7-day invites (`household.ts:32-50`) and nothing
      revokes them; `removeMemberAction` (`:383-410`) leaves pending
      invites, never-expiring shopping-list share tokens and the calendar
      feed token intact. A contributor expecting removal can mint an invite
      and rejoin, or keep reading/ticking a shared list and the meal/bill
      feed. Add `Invitation.createdByUserId` (migration), delete that
      member's pending invites on remove/leave, add list/revoke pending
      invites to the Household page, and prompt the owner to rotate share
      links and the calendar feed after a removal (or rotate
      automatically). Test: `invitation.deleteMany` with that user's id
      after `removeMemberAction`.

---

- [ ] **GAP-57. "Tonight's dinner" nudge in the morning, opt-in**
      (impact: low-med, effort: M) `[schema]` — Plan to Eat and
      Cozi/Mealime-style planners remind you what is on the menu; Squirrel
      only nudges after the fact (`syncMealNotLoggedNotifications`), so a
      planned dinner needing thawing or a missing ingredient goes unnoticed
      until evening. Chosen scope: a per-user toggle in the notification
      settings, **default off**, and one bell/push entry per day listing
      that day's planned meals; silent when nothing is planned or
      everything is already cooked. No other per-kind settings.
      Acceptance: a sync test covers the opt-out default, no entry on an
      empty day and household scoping; an e2e step enables the toggle and
      asserts the bell entry, on desktop and mobile.
      Decided 2026-10-19 by autopilot-product: opt-in toggle, default off.
      Why: the item's own recommendation; opt-in keeps the Guardrails on
      noisy positive alerts. See PRODUCT.md.

- [ ] **UX-133. Optional due dates on tasks, sorted by urgency** (impact:
      high, effort: L) — from the 2026-10-15 UI review. `HouseholdTask`
      has no due field and `tasks/page.tsx:23` orders by `createdAt`.
      Nothing is ever "overdue": "Water the plants" (every 3 days, done 8
      days ago) looks the same as a task that reopened a minute ago. A
      one-off like "Book the car service" can't get a date, and the
      overview's "Today" block (UX-70) has nothing to say about lateness.
      One migration: a nullable `dueDate`. Recurring tasks derive it from
      the rule UX-137 settled (REQUIREMENTS.md, Recurrence).
      Acceptance: a task can carry an optional due date. Open tasks sort
      overdue, then today, then later. An overdue row shows a
      `warning`-tinted "Overdue · 5 days" with an icon on the tasks page
      and the overview. Unit tests cover the sort and the derived date.

- [ ] **UX-134. A budget month that starts on payday** (impact: med,
      effort: L) — from the 2026-10-15 UI review. ⚠️ Money (human-only
      area). Swedish salaries land on the 25th, so most households budget
      "lönemånad", the 25th to the 24th. With calendar months, logging
      October's rent on 28 September put September (before the household
      existed) at a red "−12,500.00" and left October's rent "Due". The
      Log dialog also defaults to today, not the item's due day. One
      migration: `Household.budgetMonthStartDay` (1–28, default 1).
      Acceptance: with the start day set to 25, the month tabs, safe to
      spend and recurring statuses use 25th–24th periods. Logging an
      item from a period's Due list counts it in that period and
      defaults its date to the due day. The calculator has unit tests.

- [ ] **UX-136. Opt-in sample data for a new household** (impact: med,
      effort: L) — one migration (a nullable `sample` tag/batch column on
      the seeded models). "Try with sample data" on the first overview
      seeds a small pantry, one list, a planned week, three recipes and a
      few tasks, all tagged; "Clear sample data" removes exactly the
      tagged rows and nothing else. Restore the landing page's "example
      data" line only once this ships. Both languages.
      Acceptance: an empty household taps "Try with sample data" and sees
      rows on the overview; "Clear sample data" returns it to empty while
      a row the user added meanwhile survives.
      Decided 2026-10-20 by owner: option 1. See #396.

## Phase 3 — larger items, own PR each

### State-of-the-art UI (2026-10-04 design audit)

The owner wants the UI itself to be what sets Squirrel apart. The
benchmark is the best consumer apps on the same tasks:
- **Bring!** and **AnyList**: offline in the shop, tactile lists.
- **Todoist** and **Things**: swipe actions, instant feedback, motion.
- **Copilot Money**: charts and numbers that feel alive.

The UX items above make the app correct. These make it feel native and
delightful. Motion and view transitions shipped as UX-33, swipe row
actions as UX-35 and drag-to-dismiss sheets as UX-34. Still to come: the
charts are hand-rolled `div`s. Land UX-7 to UX-14 first:
polish on top of broken layouts is wasted. Each item keeps M7 (every
gesture has a visible button) and respects `prefers-reduced-motion`.
UX-36 (offline in the shop) needs an owner decision and sits under
"Needs a decision before building".

- [ ] **UX-41a. Command palette: go-to and quick actions** (M) — Split
      from UX-41 (too big for one PR). ⌘K / Ctrl-K opens a Base UI dialog
      palette on desktop, mounted once in the dashboard layout. Static
      commands first ("Go to budget", "Add task", "Add to Groceries"),
      filtered as you type, arrow keys + Enter, Esc closes. The palette
      stores nothing in the browser, so cookie-inventory.ts stays
      unchanged. Needs dict entries in en/sv, and
      an e2e spec for open, filter, run. No data search yet (UX-41b).
      Builds on: nothing.

- [ ] **UX-41b. Command palette: household search** (M) — Split from
      UX-41. A `searchHousehold(query)` Server Action (in
      `src/lib/actions/`) behind `requireHousehold()` that returns the top
      few inventory items, recipes, shopping lists, tasks and budget
      categories by name, every query scoped by householdId, Zod-validated,
      rate-limited like other read actions, with a unit test for the
      tenancy scoping. The palette from UX-41a shows them as grouped,
      debounced results that navigate to the row. Needs UX-41a.

- [ ] **UX-41c. Single-key shortcuts and `?` overlay** (S) — Split from
      UX-41. On list pages (shopping, inventory, tasks): `n` new, `/`
      focus search, `j`/`k` move, `x` tick. Ignored while typing in a
      field or with a dialog open. A `?` overlay lists them. Desktop only
      (hidden on touch). e2e spec on the desktop project.

- [ ] **UX-41d. Tooltips on icon-only buttons** (S) — Split from UX-41.
      A Base UI Tooltip (via a shared `IconButton` or a wrapper in
      `src/components/ui/`) on every icon-only button, using its existing
      aria-label text so the two cannot drift. Desktop hover/focus only;
      mobile unchanged. e2e: hover a known icon button, assert the
      tooltip.

- [ ] **UX-43. Visual regression screenshots in CI** (M) — Keep the polish
      from rotting. Add Playwright `toHaveScreenshot` baselines for the ten
      most-used screens:
      - dashboard, inventory, shopping list and detail, meal planner,
        tasks, budget overview, and the add-item, add-transaction and
        recipe sheets;
      - in light and dark, en and sv, on mobile and desktop;
      - with masked timestamps and a tolerance threshold.

      A diff fails the PR until a human approves the new baseline.

---

- [ ] **UX-36. Offline in the shop** (L) — first version: the active shopping
      list survives a dead zone, ticks sync later.
      - Cache the open shopping list and shopping mode for offline reads
        (service worker, `src/lib/service-worker.js`, which today shows
        only the offline page). Only the shopping list is cached; auth,
        money and everything else stay network-only.
      - Queue only **ticks (check/uncheck)** while offline and replay them
        on reconnect, with a visible "3 changes waiting" chip. Conflict
        rule: last write wins per item, and an item deleted meanwhile is
        skipped silently.
      - Offline adds and price edits are parked as a later item: they need
        id/merge rules that ticks don't.
      - Use the existing optimistic rows (UX-14) as the foundation. Any
        browser storage for the queue goes in `cookie-inventory.ts` and is
        cleared on logout.
      Acceptance: an e2e test loads the list, goes offline
      (`context.setOffline(true)`), ticks an item, sees the chip, goes
      online and asserts the tick persisted after reload, on desktop and
      mobile.
      Decided 2026-10-15 by autopilot-product: ticks-only offline queue on
      the shopping list. Why: it's the in-store case Bring! and AnyList
      cover and the smallest slice with no merge conflicts. See PRODUCT.md.

## Competitive gap scan

A running log, appended to at most once a day, of feature gaps found by
comparing Squirrel against competing single-purpose apps (AnyList, Bring!,
Listonic, Out of Milk for shopping lists; Grocy for pantry/inventory;
Mealime/Plan to Eat for meal planning; Splitwise for expense splitting;
Cozi for family-organizer/calendar features). Each dated entry is capped at
10 items and only adds items not already covered elsewhere in this file.
Treat these the same as any other backlog item once picked up: move it into
the right phase section above (or straight into a PR) rather than leaving
it here, and delete it from this section when it ships. An entry that turns
out to be a product-scope question rather than a scoped task should move to
"Needs a decision" instead, `[!]`-tagged, the same as any other item.

### 2026-09-23 scan

- [ ] **GAP-10. Voice-assistant shopping list integration (Alexa/Google Assistant)** `[!]` —
      needs a product decision, not just an estimate. AnyList and Bring!
      both support hands-free "add milk to my shopping list" via Alexa/Google
      Assistant skills — materially different from the in-app Web
      Speech API mic button, since it requires building and maintaining a
      third-party voice-platform skill/action, account-linking OAuth, and
      ongoing certification with Amazon/Google. Belongs alongside the
      `INFRA-` items as something clearly valuable but gated on
      infrastructure/credentials only the product owner can provision, not
      on engineering effort alone.

### 2026-09-24 scan

- [ ] **GAP-19. Geofenced "you're near the store" reminder** `[!]` — needs
      a product decision before scoping. Bring! prompts a push notification
      when it detects you're near a saved store, using the phone's
      background location. This app has zero geolocation code today and the
      always-on household list (AUTO-8, shipped — see REQUIREMENTS.md) already covers
      most of the same need without asking for a location permission at
      all. Real background geofencing on iOS Safari PWAs is unreliable
      without a native wrapper (`INFRA-3`), and even a foreground-only
      version (checking location when the app is opened, prompting "add
      items to this trip?") is a privacy-sensitive feature this app hasn't
      needed to reason about before — worth deciding whether it's in scope
      at all before estimating it.

- [ ] **GAP-20. A "we're away" pause on automation** `[!]` — needs a
      product decision. Several of this app's automations assume normal
      household rhythm — expiring-soon alerts, meal-not-logged nudges, and
      AUTO-8's auto-add-to-list and AUTO-10's repurchase suggestions
      all fire on a schedule that doesn't know the household is
      on vacation. Cozi-style family organizers don't solve this either, so
      there's no single pattern to copy. Options range from a single
      `Household.pausedUntil` date that every sync function
      (`getActiveNotifications`, the low-stock crossing helpers) checks and
      no-ops against, to doing nothing until AUTO-8/AUTO-10 have seen real use
      and it's clear which automations are annoying enough while away to be
      worth the added state. Recommend deferring the decision until at
      least one of those Phase 2 items has real usage.

---

### 2026-09-25 scan

- [ ] **GAP-26. "Someone's shopping now" presence on a shared list** `[!]` —
      needs an infrastructure decision before scoping. Bring! and AnyList
      show a live indicator when another household member has the same list
      open, which matters for exactly the moment this app doesn't yet handle
      well: two people at the same store both working off
      `ShoppingListShareLink`/the household's own list. Today updates only
      reach other viewers via `revalidatePath` on the next Server Action
      (`src/app/share/shopping-list/actions.ts`) — there's no polling or
      push between household members' own open tabs, so a stale list is
      silently possible for as long as nobody taps anything. A real presence
      indicator needs either short-interval polling (cheap, but a genuine
      new request pattern for a page that's otherwise fully
      Server-Action-driven) or a push channel (WebSocket/SSE — no such
      infrastructure exists in this app today, `web-push` only sends
      one-shot OS notifications). Worth deciding the mechanism before
      committing, rather than treating it as a routine feature slice.

### 2026-09-26 scan

- [ ] **GAP-35. Household-wide calendar for events, not just meals and bills** `[!]` —
      needs a product decision. Cozi's core differentiator is a shared
      family calendar for appointments, birthdays and school events —
      Squirrel's `.ics` feed (`src/lib/calendar-feed.ts`,
      `src/app/api/calendar/[token]/route.ts`) only ever publishes
      meal-plan entries and recurring-bill due dates; there's no
      `HouseholdEvent` model or in-app view for a one-off or recurring
      appointment. The delivery mechanism (the existing opt-in `.ics`
      feed, `buildCalendarFeedEvents`) is already built and could carry
      a third event source cheaply, but the feature itself needs
      decisions the meal/bill feed didn't: does an event need its own
      reminder/push, per-member visibility, or in-app recurrence — none
      of which this app's calendar surface has had to answer before.

- [ ] **GAP-36. "Give every dollar a job" zero-based budgeting** `[!]` —
      needs a product decision. YNAB's defining feature is requiring the
      month's income to be fully assigned across categories (a
      "To be budgeted" figure that must reach zero), a materially
      different philosophy from the envelope-style `monthlyLimit`/
      `rolloverEnabled` system already built (GAP-12/GAP-21,
      `BudgetCategory`/`PersonalBudgetCategory`) — that system caps
      category spending, but nothing requires or tracks whether *all*
      income has a category. Adopting it would mean reconciling a new
      "unassigned" figure against `computeSafeToSpend`
      (`src/lib/safe-to-spend-calc.ts`), which already answers a similar
      but distinct question ("what's left to spend"); worth deciding
      whether the app wants two budgeting philosophies side by side
      before scoping either the schema or the math.

- [ ] **GAP-37. Splitting an expense with someone outside the household** `[!]` —
      needs a product decision. Splitwise's core model is splitting a bill
      with any "friend," not just people who share your account.
      `TransactionSplit` (`prisma/schema.prisma`) is keyed to
      `HouseholdMember`, so every split participant must already be a full
      household member — there's no way to record "the trip to Ikea, split
      three ways with a friend who isn't on Squirrel." Supporting it breaks
      the tenancy assumption every domain row here relies on (a split
      party scoped by `householdId` via its member), and would need a real
      design for a non-member participant's identity (a name-only row with
      no login, most likely) before it's a scoped task rather than an
      open-ended one.

### 2026-09-27 scan

- [ ] **GAP-38. Per-transaction currency for expenses paid in a different currency** `[!]` —
      needs a product decision. Splitwise records each expense in whatever
      currency it was actually paid in and offers currency conversion on
      top; Squirrel's whole money model is one `Household.currencyCode`
      (GAP-13, `src/lib/currency.ts`) that every `Transaction` and
      `TransactionSplit` is assumed to be denominated in — there's no
      per-transaction currency field or exchange rate anywhere in
      `prisma/schema.prisma`. This bites hardest exactly where household
      expense splitting is most useful (`TransactionSplit`/
      `MemberSettlement`, `src/lib/settle-up-calc.ts`): a shared trip
      abroad, where the bill was paid in a currency the household doesn't
      use day to day, today has no honest way to be logged. Supporting it
      means deciding whether to store a frozen FX rate at entry time or
      convert live, and whether `computeBillPositions`/the settle-up
      balances stay single-currency internally with only the display layer
      converting — a currency-model change, not a UI tweak.

### 2026-09-28 scan

- [ ] **GAP-40. Current pantry value snapshot** (impact: low-medium, effort: S) —
      Grocy shows a running "stock value" for everything currently on the
      shelf, not just spending history. Squirrel already records
      `InventoryItem.lastKnownPrice` (`prisma/schema.prisma:297`, filled in
      by `togglePurchasedAction`/receipt scanning), but nothing sums it: the
      Cost analyzer tab (REQUIREMENTS.md, "Cost analyzer") only shows
      spending-over-time and GAP-17's expired-waste value, both about money
      already spent, never what's presently in stock. A household has no
      single number for "what's my pantry worth right now" — useful for
      insurance/moving estimates and just satisfying to see. No schema
      change needed. Acceptance: a card (inventory page or Cost analyzer)
      showing `Σ quantity × lastKnownPrice` across current stock, with a
      note distinguishing items with no recorded price rather than silently
      treating them as free; an e2e test asserts the figure renders and
      updates after an item's quantity changes.

- [ ] **GAP-41. Itemized expense splitting (assign receipt lines, not just the total)** `[!]` —
      needs a product decision. Splitwise's itemization lets a group split
      a bill by who actually had which line item, not just an even or
      fixed-share split of the total. `TransactionSplit`
      (`prisma/schema.prisma`) only ever divides one flat
      `Transaction.amount` per member (`amountOwed`/`amountPaid`) — there's
      no link from a split row to the individual `PriceHistory` rows or
      shopping-list items a receipt produced, so `SplitEditor`
      (`src/components/budget/split-editor.tsx`) can't offer "Alex had the
      wine, Sam had the snacks" today. This touches the money-computing
      surface AUTOPILOT.md flags as human-only (`*split*`, `*transaction*`),
      and needs decisions the flat-split feature didn't: whether
      itemization only makes sense off the receipt-scan flow
      (`applyReceiptScanAction`) where line items already exist, how it
      reconciles with tax/fees that aren't tied to one item, and whether
      per-item assignment replaces or layers on top of the existing
      share/paid model — a schema and UX design question, not a routine
      slice.

### 2026-10-12 scan

- [ ] **GAP-51. "Cook soon" shelf on the recipes tab** (impact: low-med, effort: S) —
      AnyList's v6 meal planning has a queue of recipes you intend to make
      soon without giving them a date. Squirrel has favorites (permanent)
      and the planner (dated) but nothing in between, so "that chili I
      want this week" gets lost or is planned on an arbitrary day. Add a
      per-recipe "Cook soon" toggle (a nullable `Recipe.cookSoonAt`
      timestamp `[schema]`, Phase 2) shown as a pinned "Cook soon" group
      at the top of the Recipes tab, ordered by when it was added; it
      clears itself when that recipe is marked cooked or placed on the
      planner. Suggest, don't mutate: nothing else changes.
      Acceptance: toggling a seeded recipe moves it into the group and
      survives reload; marking it cooked removes it; unit test for the
      auto-clear rule; e2e on desktop and mobile.

### 2026-10-13 scan

- [ ] **GAP-52. Save a week of meals as a named, reusable template** (impact: med, effort: M) `[schema]` —
      AnyList's Dec 2025 meal-plan update added saved templates, and Plan to
      Eat has long had reusable plans. Squirrel's `copyWeekAction`
      (REQUIREMENTS.md, "Meal planning", `week-planner.tsx`) only copies a
      week that already happened, so a household's favourite rotations
      ("school-week basics", "guests weekend") have to be found by
      scrolling back through the calendar, and are lost once that week
      is edited. Add `MealPlanTemplate` + `MealPlanTemplateEntry`
      (`householdId`, `name`, entries with `dayOffset 0-6`, `mealType`,
      `recipeId`/free-text title, `portions`; cascade on recipe delete
      drops the entry), mirroring the shopping `ShoppingListTemplate`
      pattern (GAP-4, `src/lib/shopping/list-templates.ts`). A "Save week
      as template" action in the planner menu and a "Plan from template"
      picker that stamps it onto the shown week, skipping slots already
      filled and offering Undo like copy-week. Suggest, don't mutate:
      nothing changes until the user confirms. Phase 2 (migration).
      Acceptance: unit tests for the offset mapping and the
      skip-filled-slots rule plus tenancy on both actions; an e2e step
      saves the seeded week, applies it to the next empty week and asserts
      the entries show, on desktop and mobile.

### 2026-10-15 scan

- [ ] **GAP-54. Import a recipe from a photo (cookbook page, recipe card)** (impact: med, effort: M) —
      Plan to Eat's late-2025 update added photo scanning of recipe cards
      and cookbook pages. Squirrel imports only from a URL
      (REQUIREMENTS.md, "Recipe import from URL",
      `src/lib/recipe-import.ts`), so a paper recipe or a screenshot is
      retyped by hand. Add a "Import from a photo" button beside the URL
      input in `RecipeFormDialog`, reusing the vision receipt-scan
      upload and provider path (`scanReceiptPhotoAction` in
      `src/lib/actions/receipt-scan.ts` and its `resolveAttempts`/
      `callAttempts`/`callGemini`/`callAnthropic` helpers; no new third
      party, no stored image) to extract name, instructions and
      ingredient rows into the same pre-fill state. Same stance as the
      URL import: never auto-save, the user reviews and edits first, and
      a failed or empty parse shows an error toast and leaves the form
      untouched. Gate it on the same check as that action:
      `resolveAttempts` is empty (`not_configured`) when neither
      `GEMINI_API_KEY` nor `ANTHROPIC_API_KEY` is set. The Tesseract OCR
      fallback in `src/lib/receipt-parsing.ts` is receipt-specific and is
      not used here, so with neither key set the button is hidden. Fold
      the photo parser's output through the existing ingredient-line
      parser so units and quantities match URL imports.
      Acceptance: unit tests for the output-to-prefill mapping and the
      unconfigured/failed-parse paths plus the tenancy check on the
      action; an e2e step (AI mocked as in the receipt specs) uploads a
      fixture image in the dialog and asserts the name and ingredient
      rows are pre-filled and nothing is saved until Save, on desktop
      and mobile.

- [ ] **GAP-55. Show when a recipe is planned on its detail view** (impact: low-med, effort: S) —
      AnyList's recipe details now list past and upcoming meal-plan dates
      for a recipe. Squirrel's recipe view says nothing about whether a
      recipe is already on this week's plan, so a household can plan the
      same dish twice or not realise a favourite was cooked last week.
      (GAP-46 covers "last cooked"; this is the upcoming side.) Add a
      read-only "Planned: Tue 21 Oct, Sat 25 Oct" line to the recipe card
      or dialog from a household-scoped query of `MealPlanEntry` rows with
      `date >= today` for that `recipeId` (limit 3), each date linking to
      `?week=` for its week. Nothing shown when there are none. No schema
      change.
      Acceptance: a loader test covers household scoping, past dates
      excluded and the limit; an e2e step plans a seeded recipe and
      asserts the date text on the recipe view on desktop and mobile.

### 2026-10-16 scan

- [ ] **GAP-56. Select several planned meals to move, re-portion or remove at once** (impact: med, effort: M) —
      Plan to Eat's late-2025 planner update added bulk editing: move,
      copy or change servings for several meals together. Squirrel only
      edits one entry at a time (REQUIREMENTS.md, "Editing a meal entry"
      and "Moving a meal entry (GAP-30)": one pencil and one move button
      per row), so shifting a week's dinners by a day, or halving every
      portion for a trip, is a dozen dialogs. Add a "Select" mode to the
      planner: tap rows to tick them (a bar shows the count), then "Move
      to…" (reuses `MoveMealDialog`'s date and meal-type picker, applied
      as a day offset so the group keeps its shape), "Portions…"
      (reuses `PortionStepper`) or "Remove". Cooked entries aren't
      selectable (same rule as move). A bulk action is one Server Action
      taking entry ids, `requireHousehold()`-scoped, all-or-nothing in a
      transaction, with an Undo toast like copy-week. No schema change.
      Mobile: the bar sits above the bottom nav, rows keep 44 px targets
      (M-rules).
      Acceptance: unit tests for the day-offset mapping, skipping cooked
      entries, tenancy (an id from another household rejects the whole
      batch) and undo; an e2e step selects two seeded entries, moves them
      a day, asserts them on the new day after reload, and halves their
      portions, on desktop and mobile.

- [ ] **GAP-58. Ingredients on a custom meal, so it reaches the shopping list** (impact: med, effort: M) `[schema]` —
      AnyList's December 2025 meal-planning update lets a plain note on the
      calendar carry ingredients that go straight to the shopping list.
      Squirrel's "Custom meal…" (`MealPlanEntry.freeformName`) has none, and
      the meal-plan → shopping-list bridge skips it (`recipeId: { not: null }`,
      REQUIREMENTS.md "Meal-plan → shopping-list bridge"), so "taco night"
      or "pasta with whatever" adds nothing to the shop and is invisible to
      the missing-ingredients check. Add an optional multi-line
      "Ingredients" field to the custom-meal form (nullable
      `MealPlanEntry.freeformIngredients String?`, Phase 2), one per line,
      read with the same line parser as smart add. The bridge preview lists those lines as
      "From custom meals", matched to inventory by the existing
      case-insensitive name rule and scaled by nothing (a custom meal has
      no portions). Marking it cooked still decrements nothing.
      Acceptance: a bridge test covers a custom meal's lines being listed,
      household scoping, blank lines dropped and a recipe-less, ingredient-less
      meal still skipped; an e2e step adds a custom meal with "2 tortillas"
      and asserts it in the bridge preview and on the list after "Add",
      on desktop and mobile.

- [ ] **GAP-59. Search the meal plan** (impact: low-med, effort: S) —
      AnyList's same update added search across the whole meal-plan
      calendar. Squirrel's planner shows one week at a time
      (`?week=yyyy-mm-dd`), so "when did we last have lasagna?" or "which
      night is taco night?" means paging week by week; GAP-46 covers only
      saved recipes' last-cooked date, not custom meals or future dates.
      Add a search field in the planner header that, after two characters,
      lists up to 20 matching entries (recipe title or `freeformName`,
      case-insensitive, within a year either side of today) as "Tue 21 Oct
      · Dinner · Lasagna", newest first, each linking to its `?week=`.
      Read-only, one household-scoped query, no schema change.
      Acceptance: a loader test covers household scoping, the date window,
      the 20 cap and freeform names; an e2e step plans a uniquely named
      custom meal two weeks ahead, searches it and follows the link to the
      right week, on desktop and mobile (field has a visible label, 44 px).

### 2026-10-18 scan

- [ ] **GAP-60. "Skip this time" on a recurring task** (impact: low-med, effort: S) `[schema]` —
      Grocy's chores page lets you skip an execution ("we're away, nobody
      watered the plants") so the schedule moves on without logging it as
      done. Squirrel's only ways past a recurring task are to tick it
      (which records a completion and credits a member in "Last done
      by") or delete it (which loses the schedule and history).
      `HouseholdTask` stores no due date: `getNextDueDate`/`isTaskOpen`
      in `src/app/dashboard/tasks/recurrence.ts` derive it as
      `completedAt + recurrenceIntervalDays`, and the tick
      (`toggleTaskCompletedAction`) overwrites `completedAt`, which feeds
      the weekly recap and "Last done by", so a skip must not write it.
      Add `HouseholdTask.skippedUntil DateTime?`. A "Skip this time" row
      action, shown only on recurring tasks that are currently open (no
      wait on UX-133's overdue concept), sets it to now +
      `recurrenceIntervalDays` and leaves `completedAt` and
      `completedByMemberId` untouched, with an Undo toast that restores
      the previous value. `isTaskOpen` treats the task as closed while
      `now < skippedUntil`, `getNextDueDate` returns the later of the two
      dates, and a tick clears `skippedUntil`. The tick's un-complete
      branch also clears `skippedUntil`, and leaves `completedAt` alone
      when only the skip closed the task, so clicking a skipped task
      reopens it without wiping the real last completion. Does not decide
      UX-137's anchoring question: if that changes the rule, it updates
      this too.
      Acceptance: `recurrence.test.ts` pins `isTaskOpen`/`getNextDueDate`
      with `skippedUntil` before, at and after now (with and without a
      `completedAt`); an action test covers household scoping, rejection
      on a non-recurring task, and that `completedAt`/
      `completedByMemberId` are not written, and that un-completing a
      skipped task clears `skippedUntil` and keeps `completedAt`; an e2e
      step skips a uniquely named daily task and sees it leave the open
      list with "Last done by" unchanged, then undoes it, on desktop and
      mobile (button name unique per row, 44 px).

- [ ] **GAP-61. Pin a note to the top of the notes board** (impact: low, effort: S) `[schema]` —
      Cozi's journal and AnyList's meal-plan "pinned entries" both let a
      lasting fact (the wifi code, the door code, "allergic to nuts")
      outlive the chronological feed. Squirrel's notes board
      (`## Household notes board`, GAP-16) is newest-first only, so a
      standing note sinks under daily chatter. Add `HouseholdNote.pinnedAt
      DateTime?`; any member may pin or unpin (same permission as delete);
      pinned notes sort first, newest-pinned first, with a visible
      "Pinned" label and an accessible Pin/Unpin button, capped at 5
      pinned so the pins don't become the feed.
      Acceptance: an action test covers household scoping, the cap and
      unpin; an e2e step pins a uniquely named note, reloads and sees it
      above a newer one, then unpins it, on desktop and mobile.
### 2026-10-19 scan

- [ ] **GAP-62. Carry a recipe ingredient's note onto the shopping list row** (impact: low-med, effort: S) —
      Grocy 3.1.0 made an ingredient's note ride along when missing
      products are added from a recipe. Squirrel stores the note
      (`RecipeIngredient.note`, "ripe", "unsalted", the prep note an
      import keeps) and shows it in the recipe sheet, but
      `addMissingIngredientsToShoppingListAction`
      (`src/app/dashboard/meal-planning/cooking-actions.ts:206`) builds its
      `itemsToCreate` without it, so the shopper at the shelf no longer
      sees "unsalted" even though `ShoppingListItem.note` (GAP-5) already
      renders as the muted second line there and on the share page. No
      schema change: copy the ingredient's note (trimmed, cut to the 200
      characters GAP-5 allows) into `note`. When two recipes add the same
      item the existing dedupe keeps the first row, so keep its note and
      skip the second's rather than merging text. Check the plan-portions
      path (`src/lib/shopping/default-list.ts`) and do the same if it
      builds rows from recipe ingredients.
      Acceptance: an action test shows a note on the ingredient reaches
      the created row's `note` (capped at 200) and a null note stays null;
      an e2e step adds a missing ingredient that has a note from a
      uniquely named recipe and sees the note under the row on the
      shopping list, on desktop and mobile.

## Needs a decision before building

- [ ] **AUTO-13. Receipts that arrive by themselves** `[!]` needs a product
      decision — ICA, Hemköp and Willys already deliver digital receipts
      (via Kivra), which would remove the photo step entirely. Options:
      - **Recommended first step:** a per-household inbound email address
        (e.g. via Resend inbound) that accepts a forwarded/auto-forwarded
        receipt email or PDF and drops it into the existing
        `RegisterReceiptDialog` review pipeline as a pending receipt.
        Needs a decision on inbound email infrastructure and on storing
        receipt content temporarily.
      - **Direct integration** with Kivra or a store's API — not
        researched; no known public API. Investigate before promising
        anything.
      Either way, the output lands in the same review → apply flow
      (with AUTO-11's auto-accepted matches), never applied unseen.
      Decided 2026-10-20 by owner: option 1 (inbound address, pending
      review only). See #399. Stays `[!]` until the owner enables Resend
      inbound and accepts temporary storage of receipt content; once they
      say that's done, it becomes a buildable Phase 3 item.

- [ ] **PRICE-1. Should manual purchase-checking ever collect a price?** `[!]`
      The cheap version has shipped (an honest empty-state hint in Cost
      analyzer), and **AUTO-4 covers most of the need without a new field**:
      prices prefill from `lastKnownPrice` and are tappable to correct. So
      decide this only after AUTO-4 ships and there's a sense of whether
      prefilled estimates plus receipt scanning populate enough cost data.
      The bigger option: an optional, low-friction price field in the
      everyday "check item off" interaction (not just receipt scan/barcode
      lookup) so Cost analyzer and the Groceries auto-expense work for
      households that shop the old-fashioned way. This is explicitly a
      flow-design trade-off — every additional field on the fastest, most
      repeated interaction in the app (checking off a shopping item) has a
      real friction cost — so it needs a product decision on whether
      "sometimes-populated cost data" is worth it, not just an engineering
      estimate.

- [ ] **BUDGET-6. Shared action-layer abstraction for both budgets?** `[!]`
      Whether to also unify `src/app/dashboard/budget/actions.ts` and
      `.../personal-budget/actions.ts` behind a thin repository-style
      abstraction (an injected `{ findCategory, createCategory,
      deleteCategory, ... }` object per scope). The archived spike argues
      against merging the underlying Prisma models, but left this smaller
      question open. Revisit only after BUDGET-2 → BUDGET-5 land and the
      real prop surface each merged component needs is known.

- [ ] **PERF-11. Pin the Vercel function region next to the database** `[!]` —
      `vercel.json` sets no `regions` and DEPLOYMENT.md doesn't mention
      one. A typical action does 3–6 sequential DB round trips; if
      functions run in the default `iad1` while Postgres is in the EU
      (Swedish users), each costs ~90 ms. Needs the product owner to check
      both regions in the dashboards; if they differ, set
      `"regions": ["<db region>"]` and document it in DEPLOYMENT.md.
      Potentially the single largest latency win.

### Infrastructure (moved from REQUIREMENTS.md's "Deferred" list)

Each is clearly valuable but needs a paid third-party service, developer
credentials only the product owner can provision, or an architecture call.

- [ ] **INFRA-1. Item photos on inventory** `[!]` — needs a blob-storage
      decision (S3 / Vercel Blob / Cloudinary / …). The app deliberately
      has zero file-storage infrastructure today (see the Profile avatar
      section in REQUIREMENTS.md for why) and shouldn't gain one ad hoc
      inside an unrelated task.
- [ ] **INFRA-2. Bank/account sync** `[!]` — needs a provider account
      (Plaid, or an EU open-banking aggregator for Swedish banks).
- [ ] **INFRA-3. Native mobile app** `[!]` — needs app store enrollment.
      The PWA is installable and has push today.
- [ ] **INFRA-4. Social login (Google/Apple)** `[!]` — needs OAuth consent
      screens / developer credentials.
- [ ] **INFRA-6. Backfill tags and GitHub Releases for versions cut
      while CI was paused** `[!]` — Actions runs again (`ci_gate:
      github` since 2026-10-13, after the 2026-10-04 to 2026-10-12
      stretch), so this is unblocked
      but needs someone with push access to tags. `release.yml` tags `vX.Y.Z`
      and creates a GitHub Release. Versions cut in-PR under the
      `ci_gate: local` stopgap got neither, so they exist only in
      `package.json` and `releases.json`. For each one below, tag the
      squash-merge commit on `master` that carries it, then run
      `gh release create vX.Y.Z` with the note from `releases.json`.
      Versions cut in-PR under the `ci_gate: local` stopgap from
      2026-10-12 join this list too. Delete the item once all of them
      are tagged. v0.47.5, v0.47.7 and v0.48.3 are deliberately left
      out: those PRs were released again by the workflow (v0.47.6,
      v0.47.8, v0.48.4, already tagged), so tagging them would publish a
      second Release for the same PR.

      | Version | PR | Merged | Cut in |
      |---|---|---|---|
      | v0.39.9 | #81 fix: recipe import DNS rebinding (SEC-2) | 2026-09-26 | #93 (catch-up) |
      | v0.40.0 | #92 feat: ingredient match review (MATCH-1) | 2026-09-27 | #93 (catch-up) |
      | v0.41.0 | #91 feat: ingredient parsing (MATCH-4) | 2026-09-27 | #93 (catch-up) |
      | v0.42.0 | #94 feat: untracked ingredients and aliases (MATCH-2) | 2026-09-27 | #93 (catch-up) |
      | v0.42.1 | #93 fix: long dialogs scroll on iOS | 2026-09-27 | #93 |
      | v0.43.0 | #95 feat: per-item unit conversions (MATCH-3) | 2026-09-27 | #95 |
      | v0.44.0 | #96 feat: item page (MATCH-6) | 2026-09-27 | #96 |
      | v0.45.0 | #98 feat: find and merge duplicate pantry items (MATCH-7) | 2026-09-27 | #98 |
      | v0.45.1 | #101 fix: drop push subscriptions on logout/password change (SEC-5) | 2026-09-28 | #101 |
      | v0.45.2 | #102 fix: item page back arrow returns to where you came from | 2026-09-28 | #102 |
      | v0.46.0 | #103 feat: remembered item names also link shopping lists and receipts (MATCH-5) | 2026-09-28 | #103 |
      | v0.46.1 | #107 fix: meet WCAG contrast in both themes and colour outcome toasts | 2026-09-28 | #107 |
      | v0.46.3 | #110 fix: count recurring income not yet logged as expected income | 2026-09-28 | #110 |
      | v0.46.2 | #108 fix: keep hand-split shared bills on the personal budget in future months | 2026-09-28 | #108 |
      | v0.46.4 | #109 fix: cap the action inputs that had no upper bound (SEC-7) | 2026-09-28 | #109 |
      | v0.46.5 | #112 fix: log only an excerpt of unparseable AI scan replies (SEC-11) | 2026-09-28 | #112 |
      | v0.46.6 | #113 fix: rate-limit the shopping-list share-token endpoints (SEC-13) | 2026-09-28 | #113 |
      | v0.46.7 | #114 fix: include notes, tasks, splits and settings in "Export my data" (SEC-10) | 2026-09-28 | #114 |
      | v0.46.8 | #118 perf: keep zod out of the meal-planning client bundle (PERF-7) | 2026-09-29 | #118 |
      | v0.46.9 | #119 fix: tell a new household what produces a notification (UX-3) | 2026-09-29 | #119 |
      | v0.46.10 | #120 fix: show the whole unit in the empty inventory's quick-add row (UX-1) | 2026-09-29 | #120 |
      | v0.46.11 | #121 fix: ellipsize Select trigger labels instead of clipping mid-word (UX-2) | 2026-09-29 | #121 |
      | v0.46.12 | #122 perf: move pushes and price-spike checks into after() (PERF-9) | 2026-09-29 | #122 |
      | v0.46.13 | #124 perf: pass only the used dictionary slices to the dashboard shell (PERF-5) | 2026-09-29 | #124 |
| v0.46.14 | #125 perf: batch the take-stock quantity update into a fixed number of queries (PERF-15) | 2026-09-29 | #125 |
      | v0.47.0 | #129 feat: choose the budget category shopping trips log to | 2026-09-30 | #129 |
      | v0.47.1 | #130 fix: show push as off when the server dropped this browser's subscription (SEC-14) | 2026-09-30 | #130 |
      | v0.47.2 | #131 perf: load inventory once per receipt instead of per unmatched line (PERF-16) | 2026-09-30 | #131 |
      | v0.47.3 | #132 perf: bound the recurring-template duplicate-period check to the current period (PERF-17) | 2026-09-30 | #132 |
      | v0.47.4 | #133 fix: make invite, reset and verification tokens single-use and hashed (SEC-8) | 2026-09-30 | #133 |
      | v0.58.0 | #183 feat: inventory mobile — one clear action, calmer rows (UX-20) | 2026-10-12 | #183 |
      | v0.58.1 | #186 fix: budget tabs scroll, no disabled primary, printed chart values (UX-23) | 2026-10-12 | #186 |
      | v0.58.2 | #187 fix: screen-reader and small-screen semantics (UX-31) | 2026-10-12 | #187 |
      | v0.59.0 | #193 feat: copy a recipe as plain text (GAP-43) | 2026-10-12 | #193 |
      | v0.59.1 | #191 fix: show server-action errors and dialog labels in the user's language (UX-16) | 2026-10-13 | #191 |
      | v0.59.2 | #192 fix: survive 200% text size without sideways scroll (UX-9) | 2026-10-13 | #192 |
      | v0.59.3 | #196 fix: survive a dropped pooled DB connection on page render (BUG-1) | 2026-10-13 | #196 |
      | v0.59.4 | #198 fix: touch-target overlaps, gaps and a wider M3 guard (UX-19) | 2026-10-13 | #198 |
      | v0.60.0 | #200 feat: freeze an expiring inventory item to extend its date (GAP-44) | 2026-10-13 | #200 |
      | v0.61.0 | #201 feat: offer to plan leftovers onto the next free dinner day (GAP-39) | 2026-10-13 | #201 |
- [ ] **INFRA-5. True offline support** `[!]` — PWA installability and
      push are built, but `src/lib/service-worker.js` only handles
      `push`/`notificationclick`: no `fetch` handler, no Cache API, so a
      navigation or Server Action with no network just fails. Needs a
      decision on what's safe to serve stale (e.g. inventory counts, a
      shopping list in a store with bad signal — the strongest use case)
      vs. what must always be fresh (auth, money).
