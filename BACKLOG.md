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

### Bugs

- [ ] **BUG-1. Ticking a shopping-list line can fail with an expired 5 s transaction** (impact: med, effort: S) —
      Sentry JAVASCRIPT-NEXTJS-4 (2 events, 2026-10-26, iOS Safari, `POST /dashboard/shopping-list/[id]`,
      vercel-production): `Transaction API error: A query cannot be executed on an expired transaction. The timeout was 5000 ms, however 5121 ms passed`,
      thrown by the first `tx.shoppingListItem.update()` of the tick transaction at `purchase-actions.ts:56-58`
      (JAVASCRIPT-NEXTJS-5 is a second PrismaClientKnownRequestError, 1 event, same day; check whether it is the same cause).
      The 5 s default also covers waiting for a pooled connection, so a cold start or a busy pool kills the tick before it does any work,
      and the shopper sees a failed check-off in the shop. Fix: pass `{ maxWait, timeout }` to the tick `$transaction`
      (and the sibling ones at `purchase-actions.ts:271`, `receipt-actions.ts:134`), keep the post-commit work
      (price-spike check) outside it, and make the failure surface as the normal retry toast rather than an unhandled error.
      Acceptance: unit test that the tick transaction is called with an explicit `timeout` above 5000 and that a
      transaction-expired error returns an error state instead of throwing.


### Security hardening (2026-09-26 audit)

Tenancy held up everywhere the audit traced it (every client id is scoped by
`householdId`/`userId`); these are the gaps around it, highest severity first.

### Performance (2026-09-26 audit)

Bundle numbers are First Load JS gzipped, measured from a production build:
shared root 206 KB; meal-planning 472 KB; shopping list 445 KB; inventory
395 KB; budget 390 KB; home 335 KB; login 260 KB.

### Client JS and caching (2026-10-26 measurement)

Measured on a production build with the seeded e2e user in Chromium
(Pixel 7 profile): JS actually loaded per dashboard page, JS coverage at
load, and timings under 4× CPU and Lighthouse's Slow 4G profile. Every
dashboard page loads the same **325 KB gz of shared JS** (Next/React
174 KB, Base UI 83, `releases.json` 39, the rest small). Pages paint at
~1 s but finish loading JS at 2.7–3.3 s, and the smallest page
(`/dashboard/notifications`, 5 KB of its own JS) still takes 2.7 s, so
the shared JS dominates that "looks ready, doesn't respond yet" window. A
page's own JS ranges from 4 KB (what's new) to 109 KB (meal planning),
and 56–78% of it is unused at load, mostly dialogs. Client navigation
fetches no new JS (the bottom bar's links prefetch the chunks), so
per-page splitting helps the cold start and hydration on slow phones,
not tab switches. Re-measure before and after each item.
`npx next analyze` attributes chunks to modules; JS coverage per route
comes from Playwright's `page.coverage`.
**`<Activity>` for the hidden tabs: tried, not worth shipping (PERF-29,
2026-10-28).** Wrapping the inactive tabs of `MealPlanningView` and
`BudgetTabs` in `<Activity mode="hidden">` (React 19.3.1, Next 16.4.3,
production build, Chromium at 4× CPU, 5 loads per page, median) made the
visible tab bar hydrate no faster in any way that clears the noise:
time to hydrated tab bar 1770 to 1803 ms (meal planning, desktop), 1968
to 1701 (meal planning, phone), 1967 to 1782 (budget, desktop) and 1899
to 1779 (budget, phone), where single runs vary by about 200 ms. Long-task
time before that point fell by 50 to 90 ms (579 to 511, 598 to 507, 540
to 476, 549 to 460 ms), about 10 to 16%. The server HTML shrank 15 to 17%
(161 to 136 KB and 168 to 139 KB) because hidden panels' markup is no
longer streamed, while their text is still in the page (the markers I
searched for were all present, so the Flight payload still carries it).
State survives a switch (the Recipes search text was kept). It does not
cut the downloaded JS (all four tabs' chunks are still in the payload),
which the item above says dominates, so the gain is a small slice of
hydration work, and it costs the hidden tabs' server-rendered DOM
(nothing to find-in-page or print before hydration) and pauses their
effects while hidden. Not worth that for about 80 ms; revisit if the
tab bodies get heavier or if per-tab code splitting (loading a tab's JS
on first open) is ever wanted, since `<Activity>` is the way to keep the
state when that lands. The measurement spec was a throwaway and is not
kept.

### Maintainability (2026-09-26 audit)

Baseline at audit time: lint clean, `tsc` clean, 104 test files / 1,860
tests passing, no `any`/`@ts-ignore` in app code. Item 7 does the
shopping-list actions per feature, in the files MAINT-3 split them into.

- [ ] **MAINT-7. Translate the remaining server-returned error messages**
      (medium, M, one PR per feature) — UX-16 added `dict.errors`, `fail()`,
      `zodFail()` and `v()` (`src/lib/actions/errors.ts`, see
      REQUIREMENTS.md "Internationalization") and converted shopping list,
      inventory, meal planning, tasks, the shared list link, household,
      auth and profile, the invite email, and checked the receipt and shelf
      scans and `parse-import-csv.ts` (codes their clients already
      translate), all done. Still English: the string-literal `error:`
      values and Zod messages in the files on `PENDING` in
      `src/lib/actions/error-strings.test.ts` (budget 35, personal budget
      19), plus `lib/recipe-import.ts` (MAINT-65 is splitting it),
      `savings-goal-calc.ts` and `budget-category-limit.ts`. Convert a
      feature at a time, add its keys to `dict.errors` (or a feature
      namespace, as `template-actions.ts` does), and delete the file from
      `PENDING`: the test fails if a clean file stays listed. Leave budget
      until BUDGET-6 is decided.
- [ ] **MAINT-12. CI and tooling gaps** (low, S, own PR — touches `package.json`/lockfile) —
      the migration drift check, Node pinning and Dependabot are done
      (REQUIREMENTS.md, "CI tiers"). Left: optionally `npm audit` and
      `knip` in CI. ESLint 10 waits on `eslint-config-next`'s plugins:
      `eslint-plugin-react` 7.37, `eslint-plugin-import` 2.32 and
      `eslint-plugin-jsx-a11y` 6.10 (the latest, 2026-10-27) declare
      `eslint` peers up to `^9`, so 10 only installs by overriding them.
      When they support 10, bump `eslint` + `eslint-config-next` in a
      separate PR and drop the `eslint` ignore in `.github/dependabot.yml`.
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


- [ ] **MAINT-74. Flaky: a phone dialog's comboboxes aren't there yet when `form-field-room` measures them** (low, S) `[!]` —
      `e2e/form-field-room.mobile.spec.ts:89` ("the shopping edit item dialog gives every combobox room on a phone") and `:98` ("the new recipe dialog gives the ingredient row room on a phone"), `mobile` project. Seen on release commit b13ba5e (2026-11-01). Line 89 failed in the local `ci:local` gate with `dialog has at least one combobox` expected `> 0`, received `0` (`expectComboboxesHaveRoom`, line 30) and passed on a re-run; line 98 failed once in the GitHub e2e job and passed on its retry. The helper measures the comboboxes once, right after the dialog opens, so it can run before the dialog's fields have rendered. Wait for the fields (`expect(...).not.toHaveCount(0)` or the dialog's heading and a field) before measuring, and check the click on the row's ⋯ menu is hydrated first (`expectHydrated`).
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/form-field-room.mobile.spec.ts --project=mobile --repeat-each=30` passes 30/30.
- [ ] **MAINT-77. Flaky: the chunk-retry tap doesn't open Add inventory item on desktop** (low, S) `[!]` —
      `e2e/inventory-lazy-dialogs.spec.ts:52` ("a failed chunk load › says so, and the next tap retries"), `desktop` project. In the GitHub e2e job on release commit b13ba5e (2026-11-01) it failed on both attempts (the retry limit, 7.7 s and 8.6 s) at line 95: `getByRole("dialog", { name: "Add inventory item" })` not visible within 5 s after the retry tap. It passed on a local re-run of the same commit. This is a new shape: MAINT-66 hardened this spec for `mobile` (merged in the same release as #968, which pre-fetches the chunks the abort refused), and MAINT-69 and MAINT-71 covered the history race and the route harness. Desktop still fails, so look at what differs there: chunks the retry needs that the abort never refused (so they are not warmed), or the dialog opening and being closed again by a history rewrite. Start from the failing run's trace.
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/inventory-lazy-dialogs.spec.ts --project=desktop --repeat-each=30` passes 30/30.
- [ ] **MAINT-79. Flaky: a saved week can't be stamped because the seed insert clashes on desktop** (low, S) `[!]` —
      `e2e/meal-plan-templates.spec.ts:20` ("a saved week can be stamped onto an empty week"), `desktop` project. In the local `npm run ci:local` run on release commit ca7801a (2026-11-01) it failed inside its own seed insert (line 31) with `duplicate key value violates unique constraint "MealPlan_householdId_weekStartDate_key"`. It passed on a local re-run of the same commit, desktop and mobile. The week it seeds collides with a `MealPlan` another test of the same worker household created: pick a week no other spec uses, or delete the row first, scoped to `E2E_HOUSEHOLD`.
      The fix is in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/meal-plan-templates.spec.ts --project=desktop --repeat-each=30` passes 30/30.
- [ ] **MAINT-80. Flaky: Safe to spend's income split can't find the "Spent" label on mobile** (low, S) —
      `e2e/budget-overview.spec.ts:213` ("Safe to spend shows where the month's income goes"), `mobile` project. Failed once in the local `ci:local` gate on `27865a6` (the UX-168 PR #994, 2026-11-01), where the test could not find the "Spent" label; the diff touched only shopping code. It passed in an isolated re-run of the spec and in the full gate on `96ce494`. Find why the split key can render late (or without that label) after the seeded rows are inserted and fix it in the app or the test's waiting, never a loosened assertion, a skip or a retry.
      Acceptance: `npx playwright test e2e/budget-overview.spec.ts:213 --project=mobile --repeat-each=30` passes 30/30.

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

### UX (2026-10-25 scout)

Sunday area: public, auth and legal pages, first-run flow. Swept `desktop`,
`mobile`, `landscape`, `tablet`, `small-phone`, `light`, `text-200` and both
dialog sweeps; all 268 + 132 tests pass and the popup probe has no phone-size
hits. Signup error paths at 320 px keep input and put errors beside the
field. WebKit was not run.

### UX (2026-10-28 scout)

Wednesday area: meal planning and recipes. Swept `desktop`, `mobile`,
`landscape`, `tablet`, `small-phone`, `light`, `text-200` and both dialog
sweeps; all 268 + 132 tests pass and the popup probe has no phone-size
hits (its one "Collapse sheet 64x16" hit is the sheet grabber, whose
`after:` pseudo-element already gives it the 44 px target). The two items
below come from `text-200-dashboard-meal-planning.png`. WebKit was not run.


### UX (2026-10-29 scout)

Thursday area: tasks, household, members. Swept `desktop`, `mobile`,
`landscape`, `tablet`, `small-phone`, `light`, `text-200` and both dialog
sweeps; all 268 + 132 tests pass. The popup probe has no phone-size hits
(its "Collapse sheet 64x16" is the sheet grabber, whose `after:`
pseudo-element gives the 44 px target). WebKit was not run, and the
per-action deep dive was not driven this run.

### UX (2026-10-31 scout)

Saturday area: overview, navigation shell, profile, notifications, what's
new. Swept `desktop`, `mobile`, `landscape`, `tablet`, `small-phone`,
`light`, `text-200` and both dialog sweeps; all 268 + 132 tests pass and the
popup probe has no phone-size hits. The `text-200` "clipped" hits on the
bottom bar's labels are the deliberate ellipsis of UX-150, not a finding.
WebKit was not run, and the per-action deep dive was not driven this run.

### UX (2026-10-31 design review)

A full design and UX review of the app, run as a dual-agent critique and
audit against DESIGN.md: 104 page screenshots (desktop and Pixel 7, en and
sv), the design-audit sweep (320 px, light, 200 % text, 117 popups
measured), ~70 driven flows (Pixel 7, 320 px, desktop, dark, Swedish at
200 %), axe-core on 16 routes, tab-order traces, reduced-motion emulation
and a contrast script over the token pairs `globals-contrast.test.ts`
does not cover. The sweep is clean (no overflow, off-screen or sub-44 px
hits anywhere); every item below is a hierarchy, first-run, theming or
accessibility finding confirmed in a screenshot or in code. Full report
with evidence: [Squirrel UX review](https://claude.ai/artifact/5ReYfhYPsSn72FRWUVk7Ew).
Items already open (UX-30, UX-66, UX-89, UX-125, UX-41c, UX-43) were
left out.

**File conflicts.** Don't build these in parallel:
- `src/components/inventory/inventory-client.tsx`: UX-166
- `src/components/shopping/shopping-list-client.tsx`, `shopping-mode.tsx`:
  UX-160
- `src/components/dashboard/page-title.tsx`, `dashboard/layout.tsx`:
  UX-160



- [ ] **UX-157. A dark theme that keeps the brand hue** (impact: med,
      effort: M) — breaks Squirrel design principles ("soft, friendly and
      purple … the brand's purple is carried by the mascot and the
      gradient"). `.dark` uses a hueless ground (`--background:
      oklch(0.145 0 0)`), a gradient from `#180828` to `#0a0414` that
      barely registers, and charcoal cards; purple survives only on the CTA
      and active tab (`src/app/globals.css:239-270`; report `e1-dark-overview`
      vs `overview-mobile`).
      Acceptance: dark ground, gradient and card tokens share light's hue
      family (around `oklch(0.17 0.03 300)`, `oklch(0.24 0.06 300)` →
      `oklch(0.14 0.03 300)`, `oklch(0.23 0.03 300)`); every pair in
      `globals-contrast.test.ts` still passes; the `light` and default dark
      sweep screenshots of the overview are reviewed side by side.

- [ ] **UX-160. Swedish at 200 % text on budget and shopping** (impact:
      med, effort: M) — breaks M9 ("200 % … without clipping; Swedish
      strings wrap or truncate with the full value reachable"). At 200 %
      in `sv` the budget title breaks mid-word ("Hushållsbudg / et"), the
      floating primary pill spans the width and covers the month switcher,
      and on the shopping list the dock truncates "Näst… / Bak…" and
      covers the list. In `en` at 200 % the smart-add placeholder collapses
      to "Ac" because the mic and scan buttons keep their width
      (`text-200-dashboard-shopping-list-id.png`; report `h11-budget-sv200`,
      `k5-sv200-shopping`). Files: `page-title.tsx`, `primary-action.tsx`,
      `shopping-mode.tsx` (dock), `smart-add-bar.tsx`.
      Acceptance: `PageTitle` sets `hyphens-auto` with the page `lang`;
      the pill is capped at 60 % width and drops to icon + short label
      above 150 % text; the dock collapses to ring + count when `main` is
      shorter than twice the dock; the smart-add icons shrink before the
      field. `text-size.mobile.spec.ts` extends to `sv` and asserts the
      month switcher and at least one list row stay visible.

- [ ] **UX-161. Contrast on avatar initials, selected chips and faded
      table text** (impact: med, effort: S) — breaks Accessibility tokens
      ("every text pair passes 4.5:1 in both themes"; WCAG 1.4.3). Avatar
      initials are `text-white` on `bg-chart-*` (2.05:1 on chart-2 in
      light, axe `color-contrast`; `src/components/profile/avatar.tsx:48`).
      Selected chips use `text-primary` on `bg-primary/10` (4.45:1 light,
      4.40:1 dark at 14 px medium; `recipe-form-dialog.tsx:912`,
      `starter-category-picker.tsx:118`, `item-catalog.tsx:91`).
      `text-muted-foreground/70` in the inventory table is 3.27:1 light
      (`inventory-table.tsx:422,527`). None of the pairs is in
      `globals-contrast.test.ts`.
      Acceptance: initials pick their ink per tint by luminance; chips use
      `bg-primary/15` with an ink that passes; the `/70` opacity is dropped;
      all three pairs are added to `globals-contrast.test.ts`; axe on
      `/dashboard/profile` reports no contrast violation.

- [ ] **UX-162. Raw amber utilities where the `warning` token belongs**
      (impact: low, effort: S) — breaks Colour ("status is text on a tint
      of itself … `warning`") and the checklist's "tokens only".
      `calendar-feed-setting.tsx:62-63` (`bg-amber-500/10`,
      `text-amber-600 dark:text-amber-400`), `item-catalog.tsx:178`,
      `add-item-dialog.tsx:259`, `recipe-manager.tsx:495` (favourite star);
      `amber-600` on its tint over card is 2.91:1 in light.
      Acceptance: no `amber-` class in `src/components`; the four sites use
      `bg-warning/10 text-warning` (`attention` for the star if orange is
      wanted); a grep test or lint rule keeps them out.

- [ ] **UX-167. Unique hue per section** (impact: low, effort: S) —
      breaks Consistency ("same icon/colour for the same meaning").
      Inventory and Household budget share `chart-1`, Shopping and Personal
      budget `chart-2`, Meals and Household `chart-3`, Tasks and Profile
      `chart-5` (`src/components/dashboard/nav-items.ts:84-92`), so the
      underline under a page title says "pink", not "inventory".
      Acceptance: the four hues are reserved for the four coloured
      bottom-bar tabs and More-menu pages have no underline (or get their
      own hues); `nav-items.test.ts` asserts no two primary tabs share a
      colour.

- [ ] **UX-171. Hide controls that have nothing to act on** (impact: low,
      effort: S) — breaks Usability ("every state is designed"). The meal
      plan search field shows above an empty planner
      (`mobile-en-dashboard-meal-planning.png`), "Mark all as read" with no
      notifications (`mobile-en-dashboard-notifications.png`), "Export CSV"
      on an empty transactions list, and the planner's empty state says
      "fill the empty days from the ⋯ menu" instead of offering the action.
      Acceptance: each control is hidden or disabled with a reason until
      there is data; the planner empty state has a "Fill empty days" button.
      `empty-states.spec.ts` asserts the search field is absent on an empty
      plan and the fill button is present, `desktop` and `mobile`.

- [ ] **UX-172. Item page: status and buy action before unit algebra**
      (impact: low, effort: S) — breaks Match with the real world and
      Hierarchy. The inventory item page opens with "1 pcs = 2000 g" and
      "Try it: 1 g = 0.0005 pcs" above the item's status and its buy
      action (`mobile-en-dashboard-inventory-items-id.png`,
      `src/components/inventory/item-page/`).
      Acceptance: status, quantity stepper and "Add to list" are the first
      card; conversions sit behind a "Units" disclosure. `item-page.spec.ts`
      asserts the first heading after the title is the status card.

- [ ] **UX-173. Landing desktop CTA above the fold on short windows**
      (impact: low, effort: S) — breaks Persuade-mode basics. At 1280×720
      the hero headline and note stack push "Get started free" to ~y 885
      (`desktop-en-root.png`; `src/components/landing/fridge-door.tsx`).
      Mobile is fine.
      Acceptance: at 1280×720 the primary CTA's bottom edge is inside the
      first viewport; `landing.spec.ts` asserts it on `desktop` with that
      viewport.

- [ ] **UX-174. Progressive explanations on budget Manage and Household
      settings** (impact: low, effort: M) — breaks Help ("explain
      progressively") and M6. Budget Manage opens three cards each with a
      four-line paragraph and a button wrapped to half width before any
      data; Household settings is ~3 000 CSS px of stacked forms on a phone
      (`mobile-en-dashboard-household.png`; report `h9-manage`).
      Acceptance: one line per Manage card with a "Learn more" disclosure;
      Household settings split into Members / Notes / Settings tabs on
      phones; `mobile` smoke screenshots of both pages fit in two screens
      of content before the first form.

- [ ] **UX-175. Small code hygiene from the audit** (impact: low, effort:
      S) — `transition-all` on `button.tsx:8` and `badge.tsx:7` animates
      layout properties (DESIGN.md prefers explicit properties); an ad-hoc
      shadow with raw rgb on the inventory bulk bar
      (`inventory-table.tsx:292`); `/dashboard/whats-new`'s `main` is a
      scroll region with nothing focusable on phones (axe
      `scrollable-region-focusable`).
      Acceptance: `transition-[color,background-color,border-color,box-shadow,transform]`
      on both primitives; the bulk bar uses a token shadow; What's new has a
      focusable "Back" link or `tabIndex={-1}` on `main`; axe on
      `/dashboard/whats-new` is clean on `mobile`.

### UX (2026-10-31 budget redesign follow-ups)

The budget redesign (REQUIREMENTS.md, "Budget page layout") changed layout
only. These two from its design add a write path each, so they're their own
items. Mock-ups: the "Add transaction — split built in" artboard of the
owner's budget redesign canvas.

- [ ] **UX-178. Split with household from Add transaction** (M) — On
      Personal Budget, "Log a shared expense" is a second button beside the
      tabs, opening its own dialog. Fold it into the Add transaction sheet
      as a "Split with household" switch (paid by you, shared with the
      household's members, "{name}'s share {amount}" with Change), which
      posts the same way LogSharedExpenseDialog does. The separate button
      goes, leaving one action next to the tabs. e2e: log a split expense
      from the sheet and see it on the household budget and as the other
      member's debt.
- [ ] **UX-179. "Repeats" switch on a new transaction** (M) — UX-113 took
      "This repeats" off new transactions because the flag fed a hidden
      estimate. Bring the idea back properly: a "Repeats" switch on the
      Add transaction sheet that, on save, also creates a monthly recurring
      item (Bills & income) from the transaction and marks this period
      logged. Server Action plus unit tests (tenancy, both budgets); e2e:
      the item shows under Repeating as Logged.

### Dependencies

---

## Phase 2 — schema changes, one at a time

Each item adds a migration (`npx prisma migrate dev --name <name>`, local
only — production only ever runs `migrate deploy`). Land sequentially; the
order below is a suggestion, not a dependency, unless noted.

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
UX-36 (offline ticks in the shop) shipped; UX-36b parks offline adds
and price edits.

- [ ] **UX-41c. Single-key shortcuts and `?` overlay** (S) — Split from
      UX-41. On list pages (shopping, inventory, tasks): `n` new, `/`
      focus search, `j`/`k` move, `x` tick. Ignored while typing in a
      field or with a dialog open. A `?` overlay lists them. Desktop only
      (hidden on touch). e2e spec on the desktop project.

- [ ] **UX-43. Visual regression screenshots in CI** (M) `[!]` needs a decision on
      how baselines are made — Keep the polish
      from rotting. Add Playwright `toHaveScreenshot` baselines for the ten
      most-used screens:
      - dashboard, inventory, shopping list and detail, meal planner,
        tasks, budget overview, and the add-item, add-transaction and
        recipe sheets;
      - in light and dark, en and sv, on mobile and desktop;
      - with masked timestamps and a tolerance threshold.

      A diff fails the PR until a human approves the new baseline.

      **Blocked (autopilot-build, 2026-10-28): baselines can't be made
      deterministic from an agent session.** `toHaveScreenshot` compares
      pixels, so the PNGs must come from the same Chromium build and font
      set as the GitHub `ubuntu-latest` runner. The agent sandbox has a
      different prebuilt Chromium (`/opt/pw-browsers`, `playwright.config.ts`
      falls back to it) and a different font set, and `playwright install`
      isn't allowed there, so baselines committed from it would fail on
      the first CI run (or force a loose tolerance that hides real
      regressions). Also open: seeded data is date-relative (greetings,
      weekday headers, due dates), so more than timestamps need masking
      or a frozen clock.
      **Question for the owner:** OK to generate baselines on the runner
      itself? Proposed: a `workflow_dispatch` "Update screenshots"
      workflow (a human-only edit to `.github/workflows/`) that runs
      `playwright test --update-snapshots` on the e2e job's image and
      commits the PNGs to the PR branch; a normal e2e run then compares,
      only on PRs into `master`, in a separate `visual` project with
      `maxDiffPixelRatio` ~0.01, `page.clock` frozen, `animations:
      "disabled"` and masks. Keeping the set small (10 screens x
      light/dark x en/sv x mobile/desktop is 80 PNGs; suggest desktop+mobile
      en light plus sv/dark on mobile only, about 30) keeps runtime and
      repo size reasonable. Once decided, this is a buildable M.

---

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

### 2026-10-27 scan

- [ ] **GAP-66. Per-item stock history ("who changed the amount, and when")** (impact: low-med, effort: M) `[schema]` —
      Grocy's "Stock journal" lists every change to a product (consumed,
      purchased, spoiled, adjusted) with who made it, and Bring! shows who
      did what on a shared list. Squirrel's item page shows the current
      quantity and a few derived dates, but nothing explains why the
      amount is what it is, so "who used the last of the rice?" or "why
      does it say 0?" has no answer in a shared household. Add an
      append-only `InventoryItemEvent` (itemId, householdId, nullable
      plain-string `userId` with no `@relation` so a leaving member takes
      no history with them, `delta`, `reason`: `used | restocked |
      adjusted | cooked | trip`, `createdAt`), written by the existing
      quantity actions (+/-, quantity sheet, mark cooked, finish trip)
      and capped to the last 50 per item. Show it as a collapsed "History"
      list at the bottom of the item page (`/dashboard/inventory/items/[id]`),
      newest first, "Anna used 1 · 2 days ago". Scope: no chart, no
      household-wide feed, no backfill, no notification.
      Acceptance: unit tests that each quantity action writes one event
      with the session user's id (never one from the client), scoped by
      `requireHousehold()`, and that the 51st event drops the oldest; an
      e2e step on `mobile` decrements a uniquely named item and sees
      "used 1" with the actor's name under History after a reload, in
      `en` and `sv`.

### 2026-10-31 scan

- [ ] **GAP-68. Store loyalty-card numbers on a shopping store** `[!]` —
      Bring! lets members save loyalty cards in the app and show the
      barcode at the till, one of its most-used extras, and Squirrel
      already knows each household's stores (price history, trip
      receipts). A card number is new personal data stored per member
      (and a barcode render), so it needs the owner's call on whether
      it is in scope, who can see a card (own only vs household), and
      the privacy page wording. Recommended: keep not doing it; a
      wallet app does this better and the data is sensitive.
      Acceptance (if approved): a per-user card on a store, shown as a
      Code 128/EAN barcode at full brightness on `mobile`, never
      visible to other members and never in logs.

## Needs a decision before building

- [ ] **UX-176. DESIGN.md names shadow and type tokens the CSS never
      defines** (M) `[!]` needs a decision — `globals.css` has no
      `--shadow-*` and no `--text-*` tokens, yet DESIGN.md §3 specifies
      `shadow-primary`, `shadow-primary-hover`, `shadow-popover` and a type
      scale (`page-title`, `item-title`, `card-title`, `body`, `body-lg`,
      `button`, `badge`, `caption`, `stat`, `hero`). In code popups use
      `shadow-md`/`shadow-lg` (21 sites) and stat numbers are hand-set
      (`text-4xl`, `text-xl sm:text-3xl`, `text-3xl`; about 20 sites), so
      the checklist's "tokens only" can't be followed. Decide: (1) define
      the tokens in `@theme` and migrate the ~40 sites in one PR (fixes the
      three stat sizes on the overview, budget and safe-to-spend at once),
      or (2) rewrite DESIGN.md §3 to the Tailwind classes actually used.
      Recommended: (1). Found by the 2026-10-31 design review.
      Acceptance: DESIGN.md §3 and `globals.css` agree; a unit test greps
      `src/components` for `shadow-(sm|md|lg)` and bare `text-(3|4)xl`
      stat sizes and fails on new ones.

- [ ] **UX-177. Character pass: carry the brand into the working screens**
      (M) `[!]` needs a product decision — the 2026-10-31 design review's
      verdict: the landing page, empty states and the all-done ring carry
      Squirrel's identity; the daily screens read as a generic dashboard
      with a purple primary. Four ideas that stay inside DESIGN.md and off
      money surfaces, each its own PR once chosen: (a) render the Household
      notes board as the landing's paper notes (`note-yellow`, the
      handwriting face, slight rotation); (b) make the shopping progress
      ring an acorn outline that fills (same geometry, no new assets);
      (c) the housemate voice in the Today block ("Nothing planned for
      dinner. Last Tuesday's pasta again?" from existing data); (d) each
      section's hue carried into its empty-state dashed box at 10 %
      (depends on UX-167). The warm dark theme is UX-157. Decide which to
      build and in what order.
      Acceptance: per idea, a before/after on the `mobile` screenshots and
      the e2e spec for the touched component still passing.

- [ ] **UX-36b. Offline adds and price edits** (L) `[!]` needs a product decision — follow-up to UX-36
      (ticks only, shipped). Adding an item or editing a price with no
      signal needs client-made ids and merge rules (a duplicate name added
      on two phones, a price edit on a row someone deleted) that ticks
      don't. Decide those rules before building; the queue and replay in
      `src/lib/shopping/offline-tick-queue*.ts` are the foundation.
      Acceptance: an e2e test goes offline, adds an item and edits a price,
      sees them in the chip count, goes online and asserts both persisted
      after reload, on desktop and mobile.

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

