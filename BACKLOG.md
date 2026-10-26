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

- [ ] **PERF-19. Drop the second render after meal-planning actions** (low, S) —
      a Server Action that calls `revalidatePath` already returns the
      re-rendered page with its response, so a `router.refresh()` after it
      renders the same page (and runs all its queries) a second time. Every
      action behind these calls already revalidates `MEAL_PLANNING_PATH`:
      `week-planner.tsx:464` (`unassignBatchPortionAction`),
      `plan-portions-dialog.tsx:174` (`assignBatchPortionsAction`, success
      path only; the error path at :169 refreshes on purpose, nothing was
      revalidated), `prep-tab.tsx:158` (`undoDiscardBatchAction`),
      `fill-empty-days-dialog.tsx:100` (`undoCopyWeekAction`) and
      `record-prep-dialog.tsx:158` (`undoRecordPrepAction`). The undo calls
      run from a toast outside `startTransition`, so confirm the page still
      updates without the refresh before removing each one. Leave the
      cookie-driven refreshes (`mark-release-seen.tsx`,
      `preferences-controls.tsx`) alone: no action revalidates there.
      Acceptance: an e2e check per flow that the change shows without a
      reload (extend `e2e/meal-prep.spec.ts` and
      `meal-planner-fill-empty-days.spec.ts`), on desktop and mobile.

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

- [ ] **MAINT-54. Flaky: `recipe-ingredients` water default ("Don't track") fails under full-suite load** (low, S) —
      `e2e/recipe-ingredients.spec.ts:194` (`desktop`). Failed in the
      release gate's full `ci:local` run on `fbeb1fb` (release PR #651,
      2026-10-24) and passed on a solo rerun of the same commit. Nobody's
      change is in it. The failing assertion wasn't recorded: reproduce
      with the repeat run, read the snapshot, and fix it in the app or the
      spec's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/recipe-ingredients.spec.ts:194
      --project=desktop --repeat-each=30` passes 30/30.

- [ ] **MAINT-55. Flaky: `ux-51` footer language button doesn't show it is busy until the change is saved** (low, S) —
      `e2e/ux-51.spec.ts:104` (`mobile`). Failed in the release gate's
      full `ci:local` run on `fbeb1fb` (release PR #651, 2026-10-24; a
      `toHaveCSS` assertion) and passed on a solo rerun of the same
      commit. Nobody's change is in it. Reproduce with the repeat run and
      fix it in the app or the spec's waiting, never a loosened
      assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/ux-51.spec.ts:104
      --project=mobile --repeat-each=30` passes 30/30.

- [ ] **MAINT-57. Flaky: `openRecipesTab` leaves the Recipes tab unselected after the click on a phone** (low, S) —
      `e2e/recipe-dialog.spec.ts:43` and `e2e/recipe-planned-dates.spec.ts:55`
      (`mobile`). Both failed once and passed on the retry in the GitHub
      `End-to-end (Playwright)` job of release PR #666 on `8d2e088`
      (2026-10-24). Nobody's change is in them. Same failure at
      `e2e/ui.ts:330`: after `tab.click()`, `expect(tab).toHaveAttribute(
      "aria-selected", "true")` still reads `false` after 5 s, although
      the helper already waits for hydration and a patched `replaceState`.
      Find out what the click races with (a re-render that resets the
      tab, the `?tab=` URL sync) and fix it in the app or in the helper's
      waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/recipe-dialog.spec.ts:43
      e2e/recipe-planned-dates.spec.ts:55 --project=mobile
      --repeat-each=30` passes 30/30.

- [ ] **MAINT-58. Flaky: `task-caught-up` the worker's household still has an open task when the spec expects none** (low, S) —
      `e2e/task-caught-up.spec.ts:77` "with nothing open, a fresh visit
      shows the all-caught-up card above Completed" (`mobile`). Failed once
      and passed on the retry in the GitHub `End-to-end (Playwright)` job
      of release PR #689 (run 40184348720, 2026-10-25). Nobody's change is
      in it. The failing assertion is the Postgres poll near line 111,
      `expect(received).toBe(0)`: the count of open `HouseholdTask` rows
      for `E2E_HOUSEHOLD` is still 1 after the 5 s predicate timeout. This
      spec was already touched by MAINT-40 (#585, wait for each tick's
      save) and MAINT-50 (#679, wait for hydration), so those fixes were
      probably incomplete. Find out where the open row comes from: a tick
      whose Server Action response was another action's (the
      `waitForResponse` matches any `next-action` POST, so a different
      action can satisfy it before the tick's save lands), a row another
      spec in the same worker inserts while this one runs, or a save the
      app drops. Fix it in the app or in the spec's waiting (match the
      tick's own response), never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/task-caught-up.spec.ts:77
      --project=mobile --repeat-each=30` passes 30/30.

- [ ] **MAINT-59. Flaky: `planned-expenses` spec times out under full-suite load** (low, S) —
      `e2e/planned-expenses.spec.ts:82` (`mobile`) hit the 30 s test
      timeout once in the `ci:local` gate of #694 (`7adc31c`, 2026-10-25)
      and passed 3 of 3 on a re-run on the same commit; it passed 5 of 5 on
      clean `next` (`18e4bfe`), so it needs load to show. Nobody's change is
      in it. Find what the test is waiting on (hydration, a dialog, a
      response) and fix it in the app or the spec's waiting, never a
      loosened assertion, a skip or a retry. Acceptance: `npx playwright
      test e2e/planned-expenses.spec.ts:82 --project=mobile
      --repeat-each=30` passes 30/30.

- [ ] **MAINT-60. Flaky: `meal-prep` shows "2 of 4 portions left" where the spec expects "3 of 4"** (low, S) —
      `e2e/meal-prep.spec.ts:145` (`desktop`) failed once in the `ci:local`
      gate of #697 (`afb0cbe`, 2026-10-25): expected "3 of 4 portions
      left", got "2 of 4". Only `e2e/item-aliases.spec.ts` changed in that
      PR, so nobody's change is in it. Not yet re-run on clean `next`.
      Find out whether a portion is taken twice (a double tap or a repeated
      action), or a row another spec in the same worker leaves behind, and
      fix it in the app or the spec's setup, never a loosened assertion, a
      skip or a retry. Acceptance: `npx playwright test
      e2e/meal-prep.spec.ts:145 --project=desktop --repeat-each=30`
      passes 30/30.

- [ ] **MAINT-61. Flaky: `meal-planner-bulk` leaves a dialog or selection open under load** (low, S) —
      `e2e/meal-planner-bulk.spec.ts:101` (`mobile`) failed once in the
      `ci:local` gate of #696 (`6de6c89`, 2026-10-25), a PR that touches
      only the budget split dialogs. Not yet re-run on clean `next`. Look at
      the failing assertion in the gate log's first failure output (re-run
      with `--repeat-each=30` to get it), find what the click races with and
      fix it in the app or the spec's waiting, never a loosened assertion, a
      skip or a retry. Acceptance: `npx playwright test
      e2e/meal-planner-bulk.spec.ts:101 --project=mobile --repeat-each=30`
      passes 30/30.

- [ ] **MAINT-62. Flaky: `inventory-status-summary` Status filter doesn't offer Expiring and Expired** (low, S) —
      `e2e/inventory-status-summary.spec.ts:130` ("the Status filter offers
      Expiring and Expired", `desktop`) failed once in a full local
      `ci:local` run on release commit `1b8abde` (2026-10-25). It passed on
      a solo re-run and in the GitHub e2e job of the same commit, so it
      only fails under full-suite load. Not yet re-run with repeats. Get
      the failing assertion with `--repeat-each=30` (the log of the
      original run wasn't kept), find what the filter control's open or
      option check races with (a popup still animating, or the search
      box's debounced filter re-rendering the list) and fix it in the app
      or the spec's waiting, never a loosened assertion, a skip or a
      retry. Acceptance: `npx playwright test
      e2e/inventory-status-summary.spec.ts:130 --project=desktop
      --repeat-each=30` passes 30/30.


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

#### Logged out, signup and invites

- [ ] **UX-66. Legal pages in Swedish (or marked English), with an
      accurate "who we are"** (impact: med, effort: M) `[!]` — breaks Context
      and Accessibility. ⚠️ Touches the privacy page (human-only area).
      Blocked: needs the owner. Rewriting "who we are" and any Swedish
      legal text is privacy-policy wording (AUTOPILOT.md `never_decide`).
      Question: (1) Swedish translation of the policy, or (2) keep it
      English with `lang="en"` and an "Only available in English" note?
      And what is the accurate "who we are" sentence for how Squirrel is
      offered? Once decided, the jump list and `lang` markup are buildable.
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

#### First run and the overview


#### Profile and household settings

#### Shopping

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

### UX (2026-10-23 scout)

Friday area: household and personal budgets. Swept `desktop`, `mobile`,
`landscape`, `tablet`, `small-phone`, `light`, `text-200` and both dialog
sweeps; every route passes and the popup probe has no phone-size or
off-screen hits in the budget dialogs. WebKit was not run.


### Dependencies

- [ ] **DEPS-2. Clear the transitive audit findings** (impact: med, effort: S) —
      `brace-expansion` (under `glob`), `sharp`, `source-map-js` (all high)
      and `fast-uri` (moderate) all have fixes available via
      `npm audit fix` or an `overrides` entry. Leave the Prisma-owned
      `mysql2`/`deepmerge-ts`/`@prisma/config` findings to SEC-12.
      Acceptance: `npm audit --omit=dev` lists only the SEC-12 findings;
      `npm run check && npm run build` is green.

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

- [ ] **UX-41b. Command palette: household search** (M) — Split from
      UX-41. A `searchHousehold(query)` Server Action (in
      `src/lib/actions/`) behind `requireHousehold()` that returns the top
      few inventory items, recipes, shopping lists, tasks and budget
      categories by name, every query scoped by householdId, Zod-validated,
      rate-limited like other read actions, with a unit test for the
      tenancy scoping. The palette from UX-41a shows them as grouped,
      debounced results that navigate to the row. Builds on UX-41a (shipped).

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

### Server caching (2026-10-22 review)

Today nothing is cached across requests: every dashboard page renders
fresh per request, `React.cache()` only dedupes within one request, and
the 31 action files invalidate with `revalidatePath` (46 calls for
`"/dashboard"` alone), which mostly just clears the browser's router cache.

- [ ] **PERF-22. Spike: Cache Components with household-scoped tags** (L) —
      a time-boxed spike that ends in follow-up items, not a merged
      migration. Next 16's `cacheComponents: true` plus `"use cache"`,
      `cacheTag` and `updateTag` would give each page a static shell and
      serve cached data, rendered only when a household's data changes.
      The flag is app-wide, so the spike is a throwaway branch that turns
      it on and records:
      - Which routes fail the build (uncached reads or `cookies()` outside
        a `<Suspense>`). Locale comes from a cookie, so expect most,
        starting with `src/app/dashboard/layout.tsx`.
      - A pilot: the home page summary (`src/app/dashboard/page.tsx:67-142`,
        ~13 queries plus `loadHouseholdSafeToSpend`) behind `"use cache"`,
        with before/after server timings.
      - Whether Vercel needs `"use cache: remote"` for hits across
        serverless instances (the default store is in-memory per
        instance).
      Rules the follow-up design must keep:
      - Cached functions take `householdId` (or `userId` for the personal
        budget) as an argument so it's in the cache key, and are only
        called after `requireHousehold()`. One helper builds every tag
        (`householdTag(id, "inventory")`), so no tag is ever unscoped.
      - Every write clears the tags it touches: `updateTag` in Server
        Actions, `revalidateTag` in the cron routes
        (`api/cron/sync-notifications`, `weekly-digest`) and the share-link
        actions (`src/app/share/shopping-list/actions.ts`), which write outside a
        session.
      - Never cache `requireHousehold()` / `requireUserId()`: their DB read
        is the SCALE-H revocation check. Keep the open shopping list
        uncached too (other members tick it live).
      Output: a short write-up in the PR (route failures, pilot timings,
      remote-cache answer, a go/no-go) plus follow-up items in this file,
      one per feature area.

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

### 2026-10-16 scan

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

### 2026-10-23 scan

- [ ] **GAP-64. "Opened today" on an item, so its use-by date shortens** (impact: low-med, effort: M) `[schema]` —
      Grocy tracks when a product was opened and applies a "days until
      due after opening" so a jar of pesto or a carton of milk shows the
      real deadline once the seal is broken. Squirrel only has the
      sealed best-before date (`InventoryItem.expiresAt`,
      `prisma/schema.prisma:335`), so an opened item reads "fine for
      2 weeks" when it's good for 3 days, and the expiring-soon count and
      digest miss it. Add a nullable `openedAt` and an optional per-item
      "days good after opening" (`shelfLifeOpenedDays`); an "Opened" row
      action stamps today, and `getExpiryStatus` (`src/lib/stock-status.ts`)
      uses the earlier of `expiresAt` and `openedAt + shelfLifeOpenedDays`.
      Nothing changes for items that never use it. Reuse the existing
      expiring/expired filters, counts and notifications; no new
      screen. Edge cases: undo within the toast, restocking clears
      `openedAt`, a typed date is never overwritten (as with
      `expiresAtEstimated`).
      Acceptance: unit tests for the effective-date maths (sealed only,
      opened earlier, opened later than sealed, no shelf-life set); an e2e
      step on `mobile` marks a uniquely named item Opened with 3 days,
      sees it under "expiring", reloads and still sees it, in `en` and `sv`.

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

- [ ] **PERF-21. Keep recently visited pages in the browser** `[!]` needs a
      product decision — Next 16 keeps no client copy of dynamic pages
      (`staleTimes.dynamic` defaults to 0), so every switch between
      bottom-bar tabs is a full server render plus that page's queries,
      even for a tab seen seconds ago. Setting
      `experimental.staleTimes: { dynamic: 30 }` in `next.config.ts` makes
      going back to it instant. Your own edits still show at once (an
      action's `revalidatePath` clears this cache). The cost: another
      household member's change can take up to 30 s to appear when you
      navigate (a reload always shows it), which matters most for a shopping
      list two people work through in the shop. Decide the window (30 s,
      shorter, or none). The flag is marked experimental. If PERF-22 goes
      ahead, `cacheLife`'s `stale` value controls this instead.
      Acceptance once decided: the config change plus an e2e check that an
      edit still shows after navigating away and back.

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

- [ ] **MAINT-63. Flaky: `recipe-form-order` recipe form order and 44 px tag chips check fails once, then passes on retry** (low, S) —
      `e2e/recipe-form-order.spec.ts:11` ("the recipe form is in recipe
      order, labelled, with 44 px tag chips", `mobile`) failed and then
      passed on the one retry of the GitHub `End-to-end (Playwright)` job
      of release commit `e1e5230` (2026-10-25). It passed in the full
      local `ci:local` run of the same commit. Not yet re-run with
      repeats. Get the failing assertion with `--repeat-each=30`, find
      what the position or chip-height measurement races with (the sheet
      still animating in, or the Recipes tab not selected yet) and fix it
      in the app or the spec's waiting, never a loosened assertion, a
      skip or a retry. Acceptance: `npx playwright test
      e2e/recipe-form-order.spec.ts:11 --project=mobile --repeat-each=30`
      passes 30/30.
