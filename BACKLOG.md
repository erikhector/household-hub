# Backlog

The single list of open work for Squirrel. Everything here is **not built
yet**; everything already shipped is documented in
[REQUIREMENTS.md](./REQUIREMENTS.md), and the planning docs that produced it
are kept for their design rationale in [`docs/archive/`](./docs/archive/)
(code comments still cite them by item).

**Picking an item:** `UX-` items go first, whatever their phase (see
AUTOPILOT.md, "What the builder may pick"). Otherwise take the lowest phase you can. Within Phase 1, anything
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
      stray committed `src/components/budget/cost-analyzer.tsx.orig`.
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

### UX (2026-10-14 scout)

- [ ] **UX-45. Compact inventory rows on phones** (impact: med, effort: S) —
      On a 412 px screen each inventory card on `/dashboard/inventory` takes
      three stacked rows (name and badge, stepper and actions, "Last updated
      <date>"), about 125 px, so six items fill two screens and the
      shopper scrolls a lot to find one (breaks M6: most important first, and
      the hierarchy principle: the identical "Last updated" line repeats on
      every row and carries the least information). Seen in
      `mobile-en-dashboard-inventory.png`.
      Acceptance: on the mobile project at least 8 seeded items fit in the
      first viewport after the header; "Last updated" moves to the item
      detail page or a tooltip-free secondary line shown only when the date
      isn't today; the stepper and edit/more buttons keep 44 px targets (M3).
      An `e2e/inventory` spec asserts the row count in view and that the
      stepper still works.

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


- [ ] **BUDGET-7. Personal budget insights must include shared expenses** (high, M)
      The Personal budget "Insights" / tabs view currently omits shared
      household transactions (splits, shared-paid bills), so a member's
      personal view under-counts their effective spending and safe-to-spend.
      - Include `TransactionSplit` / shared `Transaction` rows in the
        personal insights calculations and charts (month totals, category
        breakdowns, trend lines), attributing only the member's owed share.
      - Keep tenancy: every query still uses `requireHousehold()` and
        members only see their own split share.
      Acceptance: the Insights tabs show numbers that include the member's
      share of split transactions (unit test comparing before/after dataset);
      an e2e spec covers a seeded shared transaction that appears in the
      personal charts and month totals on both desktop and mobile.

- [ ] **UX-30. Decimal comma in number fields on iOS** `[verify on device]`
      (high if it reproduces, S) — There are 48 `type="number"
      inputMode="decimal"` fields, for example
      `transaction-dialog.tsx:319` and `quick-add-bar.tsx:102`. With a
      Swedish region, iOS's decimal pad offers only ",". WebKit has
      treated "12,5" in a number input as invalid and submitted `""`.

      Test on a Swedish-region iPhone. If it reproduces, switch money and
      quantity fields to `type="text" inputMode="decimal"` with a pattern,
      and normalise "," before Zod, reusing `item-units.ts:68`'s parser.

### Dependencies

- [ ] **DEPS-1. Upgrade Next.js 16.3.4 → 16.4.0 (critical advisories)** (impact: high, effort: S) —
      `npm audit --omit=dev` flags `next` as critical: RCE in `next/og`
      `ImageResponse` (GHSA-vcvr-r3jv-pc5j), plus cache poisoning of SSG/ISR
      pages, SSRF in Image Optimization and a Draft Mode leak, all fixed in
      16.4.0. Bump `next` and `eslint-config-next` together (16.4.0). Check
      the version-matched guide in `node_modules/next/dist/docs/` for
      breaking changes.
      Acceptance: `npm audit --omit=dev` no longer lists `next`;
      `npm run ci:local` is green.

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

### Budget component unification

The data layer (Prisma models, both `actions.ts` files, both `page.tsx`
Server Components) stays separate by design — only the Client/presentational
components merge. See the archived spike for the full file-pair inventory and
the recommended "shared base + thin wrapper" shape.

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

- [ ] **BUDGET-8. One-off shared cost / planned shared expense mechanism** (medium, M) `[schema?]`
      Households need a way to create an expected, non-recurring shared
      cost (e.g. "Group purchase: new vacuum" or "Shared bulk buy") that
      is eligible for budgets and member shares without being a recurring
      template. This covers planned joint purchases that should affect
      category budgets and safe-to-spend forecasts.
      - Proposal: add a `SharedPlan` table or a `Transaction.isPlannedShared`
        boolean plus `plannedDate` and optional `participants`/`split` info;
        or reuse `Transaction` with a `status: planned|posted` and an
        associated `TransactionSplit` prepared but not yet settled.
      - Migration: if a new column/table is needed, add a migration and
        keep read paths backward-compatible while the UI rolls out.
      Acceptance: a member can create a planned shared cost, it shows up
      in the household and personal budgets as an expected charge (at each
      participant's share) and can be converted to a real `Transaction` on
      settlement; unit tests for the create/convert flows and a short e2e
      spec for the UI flow.
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

## Phase 3 — larger items, own PR each

### State-of-the-art UI (2026-10-04 design audit)

The owner wants the UI itself to be what sets Squirrel apart. The
benchmark is the best consumer apps on the same tasks:
- **Bring!** and **AnyList**: offline in the shop, tactile lists.
- **Todoist** and **Things**: swipe actions, instant feedback, motion.
- **Copilot Money**: charts and numbers that feel alive.

The UX items above make the app correct. These make it feel native and
delightful. Today there are no view transitions, no swipe gestures, no
haptics and no drag-to-dismiss sheets, the charts are hand-rolled
`div`s, and the mascot appears on one screen. Land UX-7 to UX-14 first:
polish on top of broken layouts is wasted. Each item keeps M7 (every
gesture has a visible button) and respects `prefers-reduced-motion`.
UX-36 (offline in the shop) and UX-38 (mascot illustrations) need an owner
decision and sit under "Needs a decision before building".

- [ ] **UX-33. Motion system and view transitions** (L) — Define motion
      tokens in `globals.css` (durations, easing curves, one spring-like
      curve) and document them in DESIGN.md.

      Use React 19.2's `<ViewTransition>` with Next 16's
      `experimental.viewTransition` for:
      - tab and page changes;
      - shared-element morphs from a list row to its detail page
        (inventory item, shopping list, recipe);
      - items entering, leaving and re-sorting a list. A ticked item
        slides to "Done" instead of jumping.

      Under reduced motion everything falls back to an instant change.
      Acceptance: list add, remove and tick animate, and no layout jumps
      (CLS 0 on those interactions).

- [ ] **UX-34. Native-grade bottom sheets** (L, after UX-12) —
      - Drag the grabber or header to dismiss, with velocity and
        rubber-band.
      - Snap points (half and full) for long forms.
      - Background scale-down on iOS-style presentation.
      - Focus kept on the first field without popping the keyboard on open.

      Evaluate Base UI's own drawer primitive before writing pointer
      handling. Keep the close button, Escape and back gesture working.

- [ ] **UX-35. Swipe row actions with haptics** (M) — On shopping, task and
      inventory rows:
      - swipe right to tick, complete or "+1";
      - swipe left to reveal Delete (with an undo toast), or Edit.

      The visible row buttons stay (M7). Fire `navigator.vibrate(10)` on
      the commit threshold where supported (Android); iOS gets the visual
      snap only. Keep clear of the 20 px screen edges, which belong to the
      OS back gesture.

- [ ] **UX-37. Shopping mode that feels like a tool** (M) — Shopping mode
      (AUTO-3) already groups by store order and holds a wake lock. Add:
      - large type and full-row targets;
      - a progress ring ("12 of 18");
      - ticked items animating to a collapsed "In the cart" section;
      - an "All done" moment that offers to put things away;
      - one-handed reach (the next aisle's items near the bottom).

      Acceptance: a whole shop can be done with the thumb, without
      scrolling to the top.

- [ ] **UX-39. Charts and numbers that feel alive** (M) — Replace the
      hand-rolled budget bars with one small chart component:
      - tappable bars and segments that show their value (no hover-only);
      - a spending sparkline per category;
      - a projected end-of-month line on safe-to-spend;
      - tabular numbers that animate between values (count-up, skipped
        under reduced motion);
      - a visually hidden data table for screen readers.

      Use chart tokens in order. Copilot Money is the bar.

- [ ] **UX-40. Large-title headers and a thumb-zone action bar on phones**
      (M) —
      - Page titles start large and collapse into a compact top bar on
        scroll, iOS style, which wins back ~120 px on every page.
      - Each page's primary action ("Add item", "Add task", "Add
        transaction", "Invite member") moves into a consistent
        bottom-right floating button or a sticky bar above the bottom nav
        (M2), replacing the top-corner buttons.

      Builds on the inventory header clean-up (done).

- [ ] **UX-41. Desktop power layer: command palette and shortcuts** (M) —
      - ⌘K / Ctrl-K opens a palette that searches items, recipes, lists,
        tasks and categories, and runs actions ("Add milk to Groceries",
        "Go to budget").
      - Single-key shortcuts on list pages (`n` new, `/` search, `j`/`k`
        move, `x` tick), shown in a `?` overlay.
      - A Base UI Tooltip on every icon-only button.

      Todoist sets this bar for productivity users on desktop.

- [ ] **UX-42. Loading that looks instant** (S) — Done so far: the
      `loading.tsx` skeletons (including the `shopping-list/[id]` and
      `inventory/items` detail pages), fixed-width pending buttons
      (`PendingLabel`), and `e2e/cls.spec.ts`; see REQUIREMENTS.md, "Loading
      skeletons". Left:
      - Close the acceptance under real latency: re-run Lighthouse's mobile
        profile on a deployed build, or add latency to `e2e/cls.spec.ts`
        (delay RSC/server responses with `page.route`) so the 0.05 budget is
        exercised while Suspense sections stream in. Locally every route
        measures 0.0000 because the database answers before first paint.
      - Replace the remaining `fallback={null}` above content (household
        `SharedWithNote`, inventory `InventoryWellStockedNote`, shopping list
        `RepurchaseSuggestionsSection`, the layout's email-verification
        banner) with fixed-height placeholders only if that measurement
        shows a shift.
      - Skeleton card heights tuned per route against the real layout.

      Acceptance: Lighthouse CLS < 0.05 on every dashboard route on the
      mobile profile.

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

### 2026-10-05 scan

- [ ] **GAP-46. "Last cooked / cooked N times" on each recipe** (impact: med, effort: S) —
      Plan to Eat and Paprika show when a recipe was last made and how
      often, so a household can see what has dropped out of rotation and
      stop cooking the same five dinners. Squirrel records the data
      already: `MealPlanEntry.consumedAt` (`prisma/schema.prisma:906`) is
      set by "Mark as cooked" (REQUIREMENTS.md, "Mark meal as cooked →
      inventory decrement"), but nothing reads it back per recipe. The
      Recipes list (`RecipeManager`) shows only the favorite star and stays
      alphabetical (REQUIREMENTS.md, "Recipe favorites"). No schema change:
      a household-scoped `groupBy recipeId` over cooked entries, plus a
      pure helper for the label. Acceptance: each recipe row shows "Cooked
      3 times, last 12 Sep" (or nothing for a never-cooked recipe, not
      "0 times"), localized in `en.ts` and `sv.ts` with a `{ one, other }`
      plural; the query is scoped by `requireHousehold()` and has a unit
      test for count and latest date; an e2e test marks a seeded entry
      cooked, opens Recipes and asserts the line, on desktop and mobile.

### 2026-10-06 scan

- [ ] **GAP-47. Price history on an inventory item** (impact: med, effort: S) —
      Grocy shows every product's purchase price history (date, store,
      price, per-unit price) so a household can see whether milk is really
      getting dearer. Squirrel already records it: `PriceHistory`
      (`prisma/schema.prisma:658`) is written by purchases and receipt
      scans and feeds the spike warning and Budget → Insights, but the
      inventory item itself shows no price at all; `PriceHistory` is only
      read in `budget/page.tsx` and `receipt-scan-dialog.tsx`. No schema
      change: a household-scoped read of an item's last N rows plus the
      existing per-unit helpers in `price-spike.ts`. Acceptance: the item
      detail shows "Recent prices" (up to 10 rows: date, store if known,
      price and per-unit price) and nothing for an item with no history
      (no empty chart); the read is scoped by `requireHousehold()` and
      unit-tested for tenancy and ordering; strings in `en.ts` and
      `sv.ts`; an e2e test buys a seeded item with a price, opens it and
      asserts the row, on desktop and mobile.

- [ ] **GAP-48. Duplicate a recipe** (impact: low-med, effort: S) —
      Paprika, Mealie and AnyList let you copy a recipe to make a variant
      (vegetarian lasagne, half batch) without retyping ingredients and
      steps. Squirrel can only create from scratch or import from a URL
      (REQUIREMENTS.md, "Recipe import from URL"), and a repo search finds
      no copy action. No schema change: a Server Action that copies the
      recipe, its ingredients and tags into a new row in the same
      household, titled "<name> (copy)", favorite flag reset. Acceptance:
      a "Duplicate" action on a recipe row opens the copy for editing
      with an undo toast; it is `requireHousehold()`-scoped, rejects a
      recipe id from another household (unit test) and the copy doesn't
      share ingredient rows with the original (editing one leaves the
      other unchanged); strings in both dictionaries; an e2e test
      duplicates a seeded recipe and asserts both appear after reload, on
      desktop and mobile.

### 2026-10-12 scan

- [ ] **GAP-50. Step timers in Cook mode** (impact: med, effort: S) —
      AnyList added recipe timers that keep running while you do something
      else. Squirrel's Cook mode (GAP-42, `cook-mode-dialog.tsx`) shows
      steps but has no timer, so a cook leaves the screen for the phone's
      clock app. Detect durations in a step's text ("simmer 15 minutes",
      "koka i 10 min") with a pure helper in `cook-mode-calc.ts` and show a
      "Start 15 min timer" button on that step; a running timer shows a
      countdown chip, and when it ends the dialog shows an in-page alert
      and a short vibration where supported. In-dialog only: no push, no
      background work, nothing stored in the browser (so no
      `cookie-inventory.ts` entry). Works with no AI key.
      Acceptance: unit tests for duration parsing (en + sv, ranges like
      "10-12 min" use the upper bound, hours); an e2e step in
      `e2e/cook-mode.spec.ts` that opens a seeded step with a duration,
      starts the timer and asserts the countdown chip is visible, on
      desktop and mobile.

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

### 2026-10-14 scan

- [ ] **GAP-53. Copy the shopping list as plain text** (impact: med, effort: S) —
      Shopt (2.4.0) and most list apps (AnyList, Bring!) can send the list
      as text to someone outside the app: a partner who is at the shop
      without an account, or a neighbour picking things up. Squirrel's
      shopping list can import pasted text (`ClipboardPaste` in
      `shopping-list-client.tsx`) but has no way out; recipes got
      "Copy as text" (GAP-43, REQUIREMENTS.md "Copy a recipe as text") and
      the list has nothing equivalent. Add a "Copy as text" action in the
      list's overflow menu that writes the open (unchecked) items to the
      clipboard, one `- 2 dl Milk` line each, grouped under category
      headings when the list is grouped, via a pure `formatShoppingListText`
      (mirror `src/lib/recipe-text.ts`, reuse `formatCookQuantity`/unit
      labels). Confirm with a toast; error toast on a rejected write;
      on a coarse-pointer device with `navigator.share`, offer Share like
      the invite link does. Same stance as GAP-43: no public link, no
      schema change, no new browser storage, so every read stays behind
      `requireHousehold()`.
      Acceptance: `shopping-list-text.test.ts` covers both locales, no
      quantity, grouped vs flat, and checked items left out; an e2e step
      adds two unique items, clicks the action on desktop and mobile and
      asserts the toast and clipboard text.

## Needs a decision before building

- [ ] **UX-36. Offline in the shop** (L) `[!]` — needs a product decision on
      scope and conflict rules.
      - Cache the active shopping list and shopping mode.
      - Queue ticks, adds and price edits while offline, and sync with a
        visible "3 changes waiting" chip.
      - Use the existing optimistic rows (UX-14) as the foundation.

      Bring! and AnyList both work in a basement supermarket; today
      Squirrel shows the offline page (`service-worker.js:34-45`).

- [ ] **UX-38. Mascot-led empty states and small celebrations** (M) `[!]` —
      needs illustration assets. Use the squirrel in:
      - every empty state (no items, no lists, no meals, no tasks, all
        caught up);
      - a subtle celebration when a list is completed or the budget ends
        the month under plan.

      Use the raster mark only, per DESIGN.md's Brand mark rules, with no
      emoji, served through `next/image`. Under reduced motion, show a
      static image.

- [ ] **BUDGET-5. Product decision, then merge, `BudgetOnboarding`/`PersonalBudgetOnboarding`** `[!]` —
      household onboarding offers a one-click `StarterCategoryPicker`; personal onboarding
      only has the manual `AddCategoryDialog`. Decide: give personal budget its own
      (personal-oriented) starter set, reuse the household one, or document its absence as
      intentional. Do the structural merge only after that's decided, so the merge doesn't
      accidentally ship or hide a product decision as a side effect.

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
