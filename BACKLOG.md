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

- [ ] **SEC-12. Dependency hygiene** (low) — `npm audit --omit=dev` shows 4
      high findings, all via the `prisma` CLI (`mysql2`, `deepmerge-ts`
      through `@prisma/config`), not reachable at runtime. Move `prisma` to
      devDependencies if `scripts/vercel-build.mjs` can still run
      `migrate deploy` (check Vercel installs devDeps at build), else wait
      for the upstream fix. `next-auth` is still `5.0.0-beta.32` — track its
      advisories. Pairs with MAINT-12's Dependabot config.

### Performance (2026-09-26 audit)

Bundle numbers are First Load JS gzipped, measured from a production build:
shared root 206 KB; meal-planning 472 KB; shopping list 445 KB; inventory
395 KB; budget 390 KB; home 335 KB; login 260 KB.

- [ ] **PERF-12. Bound the budget page's all-time queries** (medium, M) —
      `CostAnalyzerSection` (`budget/page.tsx:144-148`) reads all-time
      `PriceHistory` though it shows only `MAX_SPENDING_MONTHS`;
      `splitTransactions` and `memberSettlement.findMany` (`:406-418`) are
      all-time too, and the Insights tab renders on every visit. Window
      PriceHistory (or SQL `groupBy` per month), compute settle-up balances
      with `transactionSplit.groupBy({ by: householdMemberId, _sum })`, and
      optionally render Insights only when it's the active tab. Conflicts
      with MAINT-10 (`budget/page.tsx`).
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
- [ ] **MAINT-7. Translate server-returned error messages** (medium, L, one PR per feature) —
      ~150 hardcoded English `error: "…"` strings and Zod messages reach
      Swedish users (budget 34, household 23, shopping 22, personal budget
      18, auth 13, planner 8, tasks 7), and `toFriendlyError` itself returns
      English (`errors.ts:24`). Copy the `getDictionary()` + `dict.errors.*`
      pattern from `template-actions.ts`/`recipe-actions.ts`. Also
      `"Task not found"` in `components/tasks/task-form-dialog.tsx:128` and
      12 hardcoded `aria-label="Loading"` in `page.tsx`/`loading.tsx` files.
      Start with `errors.ts`, tasks, meal-planning; leave budget until
      BUDGET-6 is decided.
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
- `ui/button.tsx`, `ui/input.tsx`, `ui/combobox.tsx`, `globals.css`: UX-8,
  UX-10
- `dashboard/sidebar.tsx`, `dashboard/bottom-nav.tsx`,
  `dashboard/layout.tsx`: UX-7, UX-27

- [ ] **UX-7. Fix the 640–1050 px layout: phone landscape, tablets, small
      laptops** (blocker, M) — Any touch device wider than 640 px gets the
      desktop shell, and that shell breaks in four places:
      - **Page scrolls sideways.** The content column in
        `dashboard/layout.tsx` (`flex flex-1 flex-col`) has no `min-w-0`,
        so the inventory header (title plus a 639 px action row on one line
        from `sm:`) pushes the page to 1042 px in an 810 px iPad and an
        863 px landscape phone.
      - **Sidebar nav is unreachable.** `sidebar.tsx:78` is `h-screen`, and
        its six footer rows take the height, so at 393 px tall only
        "Overview" and half of "Inventory" show. The other seven sections
        sit behind a ~40 px inner scroll.
      - **Inventory table shows one row.** Its fixed-height viewport
        (`sm:h-[calc(100dvh-4rem)]`) is only a row tall at that height.
      - **Back-links wrap.** "← All shopping lists" puts its arrow on a
        line of its own.

      Fix:
      - Add `min-w-0` to the column, and keep the inventory header stacked
        until `lg`.
      - Make the sidebar `h-dvh`. When the screen is short
        (`@media (max-height: 500px)`), scroll the whole aside, or fold the
        footer into a "More" menu.
      - Apply the fixed-height table viewport only from `lg` and
        `min-height: 600px`.
      - Give back-links `inline-flex whitespace-nowrap`.
      - Pad `env(safe-area-inset-left/right)` on the aside and `main`
        (landscape notch).

      Acceptance: a Playwright project at 863×393 and one at 810×1080
      (touch) runs `smoke` with no horizontal overflow, and every sidebar
      link passes `toBeInViewport()` after scrolling the aside.

- [ ] **UX-8. Size touch targets by pointer, not by width** (high, M) — The
      44 px targets and 16 px fields are gated on `max-sm:` only
      (`ui/button.tsx`, `ui/input.tsx` `md:text-sm`, the `touch-target`
      utility in `globals.css:12-19`), so iPads and landscape phones get
      desktop sizing:
      - checkboxes are ~20 px;
      - week and month arrows are 27–30 px;
      - "Add price", "Match item" and "Add meal" are ~24 px;
      - fields are 14 px on iPhones ≥ 768 px wide in landscape, so iOS
        zooms in on focus.

      Fix: add `pointer-coarse:` variants alongside `max-sm:` (44 px
      heights and widths, `text-base`), and compact only under
      `pointer-fine`.

      Acceptance: `expectTouchTargets` also runs in UX-7's touch projects
      and passes.

- [ ] **UX-9. Survive 200% text size** (high, M) — With root font-size at
      200% (Android "Font size", iOS Larger Text in the PWA), these pages
      scroll sideways or become unusable:
      - **Shopping list detail (612 px wide).** The add-items field is
        crushed to ~30 px by three fixed buttons, and "Match item" and
        delete are pushed off-screen.
      - **Meal planning (585 px).** "Jump to today" and "Add missing
        ingredients…" are `nowrap`.
      - **Inventory (449 px).** The stepper overlaps the info and "ban"
        icons, the quantity disappears and delete is clipped.
      - **Duplicates (425 px).** "Merge into …" doesn't wrap.
      - **Landing (416 px).** Header "Log in" and the CTA.
      - **Bottom-nav labels** break mid-word ("Inventor/y").

      Fix: let rows wrap, give the add field its own row, put secondary
      row actions in a ⋯ menu (see UX-20), and size nav labels to avoid
      mid-word breaks (`hyphens-auto`, or icon-only with `aria-label`
      above ~1.5× text).

      Acceptance: a spec sets `html { font-size: 200% }` and runs
      `expectNoHorizontalOverflow` on every route in `e2e/routes.ts` on the
      mobile project.

- [ ] **UX-10. No sub-16 px fields and no clipped values in form controls**
      (high, S) — These zoom the page on iOS when focused:
      - `ui/combobox.tsx:39` is `text-sm` with no phone override. It is
        used by the transaction category, recurring template, item
        combobox, shared expense and merge target fields.
      - The raw `<input>`s in `meal-planning/mark-cooked-dialog.tsx:180,219`
        are ~30 px tall and 14 px.
      - The price edit field is overridden to `text-sm`
        (`shopping-list-client.tsx:1081`).
      - The edit-item link field in the shopping row editor.

      Fix:
      - Use `text-base md:text-sm`, `border-2` and 44 px height on phones,
        matching `input.tsx`.
      - Replace the raw inputs with `Input`.
      - In the add/edit item sheet, stop the unit field showing just "p"
        for "pcs": the clear (×) button and chevron take its width, so
        widen the column or hide the clear button below `sm`.

      Acceptance: a mobile e2e check asserts every visible, focusable
      `input`/`textarea`/`[role=combobox]` in each opened dialog has a
      computed font-size ≥ 16 px. It must skip Base UI's
      `aria-hidden` hidden inputs.

- [ ] **UX-11. Back gesture closes sheets and dialogs** (high, M) — Hard rule
      M7. Nothing in `src/` touches `history`, so Android's back button,
      or a back swipe with a sheet open, leaves the page and loses the
      form. From the first screen it leaves the app.

      Fix: in `ui/dialog.tsx` (and `confirm-dialog.tsx`), `pushState` when
      the sheet opens and close it on `popstate`. When the sheet is closed
      from the UI, call `history.back()` if our entry is still on top.

      In the same PR:
      - **Merge into another item** (`/dashboard/inventory/items/[id]`)
        doesn't close on Escape, on desktop or mobile, and it shows no
        Merge or Cancel action until something is picked. Show both.
      - Add `pr-10` to `DialogHeader` so long (Swedish) titles don't run
        under the 44 px close button (`dialog.tsx:90-103`).

      Acceptance: a mobile spec opens "Add item", calls `page.goBack()`,
      and asserts the sheet closed and the URL is unchanged.

- [ ] **UX-12. On-screen keyboard and long sheets: Save always reachable**
      (high, M) — Hard rule M2.
      - `DialogFooter` (`ui/dialog.tsx:117-130`) isn't sticky, so in the
        recipe form, add/edit item and the receipt dialogs Save scrolls
        out of view.
      - There is no `interactiveWidget` in `viewport` and no
        `visualViewport` handling, so the `fixed bottom-0` sheet sits
        behind the iOS keyboard.
      - The grabber at `dialog.tsx:79-82` suggests drag-to-dismiss, but
        dragging does nothing.

      Fix:
      - Make `DialogFooter` `max-sm:sticky max-sm:bottom-0` on
        `bg-popover`.
      - Set `viewport.interactiveWidget: "resizes-content"` (Android).
      - Add a small hook that writes `--kb-inset` from `visualViewport` and
        lifts the sheet by it (iOS).
      - Remove the grabber or make it drag (see UX-34).

      Acceptance: a mobile spec fills the recipe form to the bottom and
      asserts the submit button is in the viewport without scrolling.

- [ ] **UX-13. Forms keep what the user typed after a server error** (high,
      S) — React 19 resets uncontrolled fields when a form action returns,
      even when it returns `{ error }`.
      - Signup wipes name, household, email and both passwords
        (`auth/signup-form.tsx:80-108`).
      - Login loses the email (`login-form.tsx:57`). Reset-password, the
        join sign-up form and the display-name form behave the same way.
      - Add/edit item resets quantity, threshold, expiry and use-within
        (`inventory/add-item-dialog.tsx:229-305`).
      - The transaction description resets too.

      Fix: echo non-secret values back in the action state and key
      `defaultValue` on it, or make the fields controlled.

      Acceptance: an e2e test submits signup with an email that's already
      used and asserts the name and email are still filled in.

- [ ] **UX-14. Ticking is instant: optimistic rows with per-row pending**
      (high, M) — The shopping item checkbox
      (`shopping-list-client.tsx:179,860-870`), the share page
      (`shared-shopping-list-client.tsx:36-47`), tasks
      (`tasks-client.tsx:53,150,231`) and the inventory +/− steppers
      (`inventory-table.tsx:207-213`) don't change until the server
      answers. Meanwhile one shared `useTransition` disables every row, so
      on weak in-store signal taps look lost. This breaks M5.

      Fix: `useOptimistic` per row with rollback and an error toast, as
      `recipe-manager.tsx:243-251` already does. Add stepper `aria-label`s
      ("Decrease Wheat flour") while there.

      Acceptance: an e2e test with a throttled route ticks three items in
      a row, all three are checked before any response arrives, and they
      persist after reload.

- [ ] **UX-15. Dates, months and numbers in the user's locale** (high, S) —
      Swedish users see English.
      - "October 2026" on both budget pages
        (`budget/month-navigator.tsx:37`, `toLocaleDateString(undefined)`
        in a Server Component).
      - "Sep 28 – Oct 4, 2026" on the meal planner
        (`week-planner.tsx:190-192`, a client component, which also
        risks a hydration mismatch).
      - Default list names like "Inköpslista — 10/4/2026"
        (`shopping-lists-overview.tsx:74`,
        `shopping-list/actions.ts:91,1663`, `cooking-actions.ts:242`).
      - `toFixed(2)` amounts and percentages ("12.50", "12.5%") in
        `split-editor.tsx:100-115`, `log-shared-expense-dialog.tsx:306`
        and `cost-analyzer.tsx:443`.
      - Units shown raw ("12 pcs" rather than "12 st").

      Fix: pass `locale` and use `Intl.DateTimeFormat`, `Intl.NumberFormat`
      and `createMoneyFormat`. Add a unit display label in both
      dictionaries; stored values don't change.

      Acceptance: the sv smoke run asserts "oktober" on `/dashboard/budget`
      and a Swedish week range on `/dashboard/meal-planning`.

- [ ] **UX-16. Server-action errors and leftover hardcoded strings in both
      languages** (high, M) — About 59 server-action and Zod messages are
      English only, for example `shopping-list/actions.ts:163,212`,
      `inventory/actions.ts:41`, `recipe-actions.ts:137`,
      `planner-actions.ts:24` and `lib/actions/errors.ts:24`. Swedish users
      see them in toasts and under fields.

      Also hardcoded:
      - `aria-label="Loading"` on 11 skeletons;
      - `dialog.tsx`'s "Close" (twice);
      - `invite-button.tsx`'s fallback error;
      - `global-error.tsx`, which also uses raw hex and has no dark theme.

      Fix: return dictionary keys, or resolve them with `getDictionary()`
      in the action. Add `common.loading` and `common.close`.

      Acceptance: a unit test greps `actions.ts` files for string-literal
      `error:` values and fails on any.

- [ ] **UX-17. Logged-out visitors can choose Swedish** (high, S) — The
      language toggle is only inside the dashboard, and the locale falls
      back to `en` with no Accept-Language
      (`i18n/get-dictionary.ts:25`). A Swedish person opening an invite
      link, the landing page or login gets English with no way to switch.

      Fix: honour `Accept-Language` when there is no cookie, and add the
      toggle to the public header or `LegalFooter`.

      Acceptance: `public.spec.ts` opens `/join/<token>` with
      `locale: "sv-SE"` and no cookie and sees Swedish, then switches to
      English via the toggle.

- [ ] **UX-18. Toasts clear the bottom bar and the home indicator** (medium,
      S) — `<Toaster />` (`app/layout.tsx:98`) uses Sonner's 16 px mobile
      offset. On dashboard pages every toast covers the bottom nav, and on
      iOS it reaches into the home-indicator strip, so its swipe competes
      with the home gesture. The "Undo" action button is 24 px (M3).

      Fix: `mobileOffset` with the bar height plus
      `env(safe-area-inset-bottom)` on dashboard routes, and 44 px
      `[data-button]` under `pointer: coarse`.

      In the same PR, make the copy actions (`share-list-button.tsx:102`,
      `invite-button.tsx:83`, `calendar-feed-setting.tsx:78`) await
      `clipboard.writeText` and show an error toast when it fails. Offer
      `navigator.share` on phones.

- [ ] **UX-19. Touch-target overlaps and gaps** (high, M) — M3 failures
      that the guard misses:
      - **Meal row icons overlap.** Each 44 px button sits in a 24 px
        `IconSlot` with `gap-1` (`week-planner.tsx:306-411`), so Edit,
        Move, Cooked and Delete overlap by ~16 px. Blocker.
      - **Inventory stepper covers the ⓘ icon** on a 320 px iPhone SE.
      - **Category chip edit/delete** are ~24 px and touching
        (`category-manager.tsx:226-245`).
      - **Row gaps under 8 px**: `gap-1` or `gap-1.5` in shopping rows
        (`:899`), inventory row actions (`item-actions.tsx:56`),
        transaction rows (`transaction-list.tsx:455`) and recurring rows
        (`recurring-templates-panel.tsx:377`).
      - **Small controls**: the password show/hide toggle (~24 px,
        `password-input.tsx:46`); legal footer links and "Forgot
        password?"; the "Units, recipes and details" link (16 px tall);
        smart-add suggestions (~32 px, `smart-add-bar.tsx:252`); the
        shared-row link (`size-9`, `transaction-list.tsx:401`).
      - **Guard gaps**: `expectTouchTargets` doesn't check
        `role="option"`, skips content inside `hidden` tab panels (most
        of the budget UI), and never runs on public pages.

      Fix the controls, then close those three gaps in `e2e/ui.ts`.

- [ ] **UX-20. Inventory on a phone: one clear action, calmer rows**
      (medium, M)
      - **Header**: seven icon-only buttons over two rows. The primary "+"
        sits alone in the top corner (M2); a cryptic "≡ 1" chip; and the
        ScanBarcode and ScanLine icons are hard to tell apart
        (`inventory/page.tsx:110-172`). Fix: keep a labelled "Add item"
        plus a labelled ⋯ menu (Scan, Scan multiple, Scan a shelf, Paste a
        list, Export CSV, Manage items), like the shopping list's AUTO-5
        menu.
      - **Rows**: up to five 44 px icons squeeze the quantity to "…".
        Fix: keep Edit, move Details, Mark opened, Mark empty and Delete
        into a row ⋯ menu.
      - **Small fixes**: give the quantity a fixed width with
        `tabular-nums`; label the bare date ("Updated 4 Oct"); make the
        bulk-edit bar `max-sm:sticky` at the bottom; give the mobile
        filter selects real `Label`s (`inventory-client.tsx:207-277`).

- [ ] **UX-21. Meal planner: today first, fewer placeholders** (medium, M)
      - Four rows of controls push Monday down to ~550 px on an iPhone SE.
      - The week is ~2,800 px of 28 identical "+ Add meal" rows, and
        today (Sunday) comes last. That breaks M6, which wants one "Add"
        per group.
      - Recaps above the tabs load late with `fallback={null}` and push
        the planner down (`meal-planning/page.tsx:472-479`).

      Fix: one row (‹ › and the range) plus a ⋯ menu for Copy last week
      and Add missing ingredients; scroll to today on load; one "+ Add
      meal" per empty day that asks for the slot; a fixed-height skeleton
      for the recaps.

- [ ] **UX-22. Shopping list detail polish** (medium, S)
      - On a 320 px phone the add field shrinks to "Add items, e.g. 2". Put
        mic and scan inside it as trailing adornments.
      - Row actions come in a different order on each row ([Baking][Add
        price][✎][🗑] vs [Add price][✎][Match item][🗑]). Use a fixed
        order with delete last.
      - Hide the category chip when the list is grouped by that category.
      - Make "Match item" `warning` text on its tint with an icon (it's
        low contrast in light).
      - Use one name for the receipt action ("Register receipt" on the
        index, "Scan receipt" in the detail).
      - Ask before throwing away a reviewed receipt or AI shelf scan on
        close (`receipt-scan-dialog.tsx:531`,
        `register-receipt-dialog.tsx:505`,
        `ai-shelf-scan-dialog.tsx:117`). Today a back swipe means
        re-photographing and paying for the AI call again.

- [ ] **UX-23. Budgets: tabs, the disabled primary and the charts**
      (medium, M)
      - The tabs wrap on a 320 px phone with "Insights" alone on row 2.
        Make them scroll sideways.
      - "Add transaction" is a disabled primary with no explanation (it
        reads as broken). Hide it until a category exists, or explain
        when tapped.
      - Starter-set chips show no selected state and are centred inside a
        left-aligned card.
      - Put safe-to-spend above `DueRecurringWidget`
        (`budget-tabs.tsx:270`).
      - The fixed-budget bars carry their values only in `title`
        (`fixed-budget-summary.tsx:195-215`). Print them, as
        `cost-analyzer.tsx:120` does, and use `chart-1..3`.
      - Transaction delete: pass the promise to `ConfirmDialog` so
        "Deleting…" shows (`transaction-list.tsx:178-183`).
      - Recurring rows: `flex-wrap` the title row so Swedish names don't
        truncate to nothing (`:342`).

- [ ] **UX-24. One primary action per view** (medium, S) — Hierarchy.
      - Profile has four primaries (Save, Save, Update email, Update
        password).
      - Household has "Add note" and "Turn on calendar feed", while its
        page action "Invite member" is outlined.
      - The duplicates page has a primary "Merge" per group.
      - The task create dialog's submit is `outline`, with no Cancel; the
        edit dialog has both. The task title also can't be edited at all
        (`task-form-dialog.tsx:155-165`).

      Fix: per-card saves are `secondary` until their form is dirty;
      solid "Owner" badges become `secondary`; task create and edit share
      one footer and a title field.

- [ ] **UX-25. Light theme polish** (medium, S) — The app defaults to dark,
      so light gets less attention:
      - Disabled primary buttons are white on pale lilac (~1.8:1) and
        look broken.
      - The active segmented tab (meal planner, budgets) barely differs
        from its track.
      - 2 px field outlines are much heavier than the 1 px card rings.
      - Overview stat numbers use `chart-1/2` as text, and the amber is
        ~2.5:1 (`dashboard/page.tsx:232,258,282`).
      - Completed onboarding rows fade to ~2.5:1.
      - The phone's sticky add bar paints a flat band over the gradient.

      Add each new token pair to `globals-contrast.test.ts`.

- [ ] **UX-26. Overview: the first screen shows today, not the setup card**
      (medium, S)
      - "Get set up" fills the whole first screen on an iPhone SE and in
        landscape even when 3 of 5 steps are done. Collapse the finished
        steps into "3 of 5 done", and let the user dismiss the card.
      - Stat-card buttons sit at different heights, and on the iPad the
        "View shopping lists" chevron sits on the border. Use `mt-auto` on
        full-width buttons.
      - The household-switcher "+" floats mid-header on every phone page.
        Align it right.

- [ ] **UX-27. Navigation always shows where you are** (medium, S)
      - Notifications and What's new highlight no bottom-bar item. Map
        them to "More".
      - Bottom-bar labels are 10.4 px and the badge 9 px
        (`bottom-nav.tsx:115,137,148`), below M9. Use ≥ 12 px and write
        the M9 exception into DESIGN.md.
      - The collapsed sidebar names its icons only in `title`
        (`sidebar.tsx:102-182`), which touch never shows. Add `aria-label`
        and a Base UI Tooltip.
      - The sidebar footer doesn't mark the active page.

- [ ] **UX-28. Public pages** (medium, S)
      - The privacy cookie table clips "Purpose" to 2–3 characters on
        phones. Stack it as a definition list.
      - `/reset-password/<bad token>` renders the full form; validate the
        token first, like the other token pages do.
      - The invalid-token pages (join, share, unsubscribe, verify) each
        look different. Use one shared status card with the logo.
      - The landing hero puts "Get started free" below the fold in
        landscape. Add `@media (max-height: 500px)` padding.
      - "Privacy Policy" and "Terms of Service" are Title Case.
      - The English-only legal body needs `lang="en"` when the UI is
        Swedish (WCAG 3.1.2), and body text in `foreground`, not muted.
      - Signup's title says "Create your household" but the button says
        "Create household".

- [ ] **UX-29. Platform polish: iOS, Android and the PWA** (medium, M)
      - **Push on iOS.** iOS Safari says push "isn't supported in this
        browser" (`push-notifications-card.tsx:41`). On iOS ≥ 16.4 outside
        standalone mode, say "Add Squirrel to your Home Screen to get
        notifications" instead.
      - **iPad install steps.** `install-app-card.tsx:38` misses iPadOS
        (it uses a desktop UA). Also check
        `platform === "MacIntel" && maxTouchPoints > 1`.
      - **Theme colour.** Add `viewport.themeColor` per colour scheme and
        align `manifest.ts`'s fixed purple `theme_color`.
      - **Tap highlight.** Add `-webkit-tap-highlight-color: transparent`,
        since `active:` states already give feedback.
      - **Reduced motion.** Add a global `prefers-reduced-motion` rule;
        today there are none in `src/`.
      - **Notification taps.** In `service-worker.js`, focus an existing
        window on `notificationclick` instead of opening a new one, and
        ship a monochrome badge icon.
      - **Small fixes**: left-align iOS date values; map speech
        `service-not-allowed` to "unavailable here"; fall back from
        `crypto.randomUUID()` (it throws over plain-HTTP LAN testing).
      - **Browser floor.** Document the minimum browser (Safari/iOS 16.4
        for `oklch`/`color-mix`) and show a notice below it.

- [ ] **UX-30. Decimal comma in number fields on iOS** `[verify on device]`
      (high if it reproduces, S) — There are 48 `type="number"
      inputMode="decimal"` fields, for example
      `transaction-dialog.tsx:319` and `quick-add-bar.tsx:102`. With a
      Swedish region, iOS's decimal pad offers only ",". WebKit has
      treated "12,5" in a number input as invalid and submitted `""`.

      Test on a Swedish-region iPhone. If it reproduces, switch money and
      quantity fields to `type="text" inputMode="decimal"` with a pattern,
      and normalise "," before Zod, reusing `item-units.ts:68`'s parser.

- [ ] **UX-31. Screen-reader and small-screen semantics** (medium, S)
      - Unread notifications are marked only by a tint and an
        `aria-label` on a role-less `<span>`
        (`notifications-history.tsx:72-82`). Add `sr-only` "Unread".
      - 34 places truncate long names with the full text only in `title`,
        which touch never shows. Use `line-clamp-2` on phones.
      - Delete-household confirm needs `autoCapitalize="off"`,
        `autoCorrect="off"`, a trimmed comparison and a Cancel button.
      - The invite email field isn't in a `<form>`, so Enter does nothing.
      - Add `autoComplete="off"` to household-data fields (the "New list"
        name currently autofills the user's own name), and
        `enterKeyHint` on each dialog's last field.
      - Add `src/app/dashboard/error.tsx` so a feature crash keeps the
        nav, with an offline message.
      - The password-change form needs a hidden `autoComplete="username"`
        field.

- [ ] **UX-32. Test the platforms we promise** (medium, M) — CI only runs
      Desktop Chrome and a Pixel 7 in Chromium, so none of the iOS issues
      above can fail a build.

      Add Playwright projects:
      - `iphone`: WebKit, `devices["iPhone 15"]`, running smoke and
        flows. CI must run `npx playwright install --with-deps webkit`.
      - `tablet`: 810×1080 touch.
      - `landscape`: 863×393 touch.
      - a 200% text pass.

      Add the 16 px field assertion from UX-10. Keep the runtime in check
      by running only `smoke` on the extra projects.

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

- [ ] **UX-34. Native-grade bottom sheets** (L, after UX-11/UX-12) —
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

      Requires UX-20's header clean-up first.

- [ ] **UX-41. Desktop power layer: command palette and shortcuts** (M) —
      - ⌘K / Ctrl-K opens a palette that searches items, recipes, lists,
        tasks and categories, and runs actions ("Add milk to Groceries",
        "Go to budget").
      - Single-key shortcuts on list pages (`n` new, `/` search, `j`/`k`
        move, `x` tick), shown in a `?` overlay.
      - A Base UI Tooltip on every icon-only button.

      Todoist sets this bar for productivity users on desktop.

- [ ] **UX-42. Loading that looks instant** (S) —
      - Each feature route gets a `loading.tsx` skeleton that matches its
        final layout (same card heights, so CLS ≈ 0).
      - Every `fallback={null}` above content is replaced with a
        fixed-height placeholder.
      - Pending-state buttons keep their width.
      - Link prefetch on hover and touchstart for the bottom bar.

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

- [ ] **GAP-39. Auto-schedule leftovers onto a future day's meal plan** `[!]` —
      needs a product decision. Plan to Eat's standout feature is leftover
      scheduling: cooking a big batch lets a household drop "leftovers"
      straight onto a later day's plan instead of re-deciding what to eat.
      Squirrel's leftovers flow (GAP-8,
      `src/app/dashboard/meal-planning/leftovers.ts`,
      `markMealEntryCookedAction`) only ever turns leftover servings into an
      `InventoryItem` ("Leftovers: <recipe>") for the pantry — it never
      creates a `MealPlan` entry, so a household still has to remember the
      leftovers exist and manually plan a day around them (or hope
      "Use it up", `src/lib/inventory/use-it-up-calc.ts`, surfaces it, which
      only happens once the item is flagged expiring or low). Turning it
      into an actual plan slot needs decisions this app hasn't made yet:
      which day it lands on by default, what happens if that day already
      has a dinner planned, and whether it's opt-in per meal or a household
      setting.

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

### 2026-09-29 scan

- [ ] **GAP-42. Cook mode on a recipe (screen stays on, tick off steps)** (impact: med, effort: M) —
      Paprika's "Cook" view keeps the screen awake, lets you cross off
      ingredients and highlight the current step; Mealie and Tandoor have
      the same. Squirrel shows a recipe's `instructions` (one step per line,
      see REQUIREMENTS.md "Recipe import from URL") only in the edit form
      (`src/components/meal-planning/recipe-form-dialog.tsx`), so cooking
      from a phone means an editing dialog that dims and locks mid-recipe.
      The screen-wake-lock hook already exists for shopping
      (`src/lib/shopping/use-screen-wake-lock.ts`, AUTO-3) and can be
      reused. No schema change; component state only, nothing stored in the
      browser (no `cookie-inventory.ts` entry). Acceptance: a "Cook" button on
      a recipe with instructions opens a full-screen read view with large
      step text, the ingredients (scaled to the meal entry's portions when
      opened from the plan) and tappable steps that dim when done; it
      requests the wake lock while open and releases it on close; an e2e test
      opens it on desktop and mobile, ticks a step and asserts it is marked
      done and that closing returns to the recipe list.

- [ ] **GAP-43. Share a recipe with someone outside the household via a link** `[!]` —
      needs a product decision. Paprika, Mealie and Tandoor let you send a
      recipe to a friend or family member. Squirrel's only sharing is inside
      a household, and every read is scoped by `requireHousehold()`, so a
      public link would be the app's first unauthenticated data read: it
      needs decisions on token format and revocation (see SEC-8 on
      single-use tokens), whether the link shows a snapshot or the live
      recipe, and whether the receiver can import it into their own
      household, which would also cross the tenancy boundary in
      `src/lib/session.ts`. A plain "copy as text" would avoid all of that
      and could be the smaller first step.

### 2026-09-30 scan

- [ ] **GAP-44. "Freeze it" on an inventory item (extends the expiry clock)** (impact: med, effort: M) —
      Grocy tracks freezing as a stock state with its own "days until due
      once frozen"; Squirrel has the mirror image for opening (`openedAt` +
      `useWithinDaysOpened`, REQUIREMENTS.md "Expiry/best-before tracking",
      `prisma/schema.prisma:326-336`) but nothing for the most common way
      households avoid waste: freezing what would otherwise expire this
      week. Today the only choice is to edit `expiresAt` by hand, which
      loses the original date and looks like a real user-entered date.
      Needs a small schema change (`frozenAt DateTime?`,
      `useWithinDaysFrozen Int?`, one migration, so a Phase 2 item) and a
      pure `frozenExpiryUpdate` beside `openedExpiryUpdate`
      (`src/lib/inventory/expiry.ts`). Acceptance: an expiring item's row
      offers "Freeze"; it sets `expiresAt = now + useWithinDaysFrozen`
      (default 90 days, estimated flag per the existing ≈ rule), shows a
      "Frozen" tag, drops out of EXPIRING_SOON, and has the same undo toast
      as "Mark opened"; a unit test covers the pure helper and an e2e test
      freezes an item, reloads and asserts the tag and later date.

- [ ] **GAP-45. "Fill empty days" on the meal planner from favorites** (impact: low-med, effort: S) —
      Mealie's meal-plan rules and Mealime's auto-planned week fill a
      week with no effort; Squirrel has "Copy last week" (GAP-23) but an
      empty first week, or one that only copies last week's repeats, still
      means adding every dinner by hand. Recipe favorites exist
      (REQUIREMENTS.md "Recipe favorites") and "Use it up" suggestions
      already rank by stock, so the ingredients for a suggestion exist. No
      schema change. Acceptance: a planner-header button proposes a
      dinner for each empty day from favorites (not repeating within the
      week), shown as a preview the user can accept, swap per day or
      cancel, with an undo toast after accepting; nothing is written
      until accepted; an e2e test accepts a proposal and asserts the
      entries appear after reload.

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

- [ ] **TASKS-1. "Tasks cleared" bell notification?** `[!]` — Household
      Tasks v1 shipped without one, deliberately (see "Household tasks" in
      REQUIREMENTS.md). Two options, no clear winner without real usage:
      - **Recommended default: keep not doing it.** The weekly tasks recap
        already gives completions a positive surface; a bell alert on top
        risks the "positive notifications become noise" failure the
        Guardrails warn about.
      - **Alternative:** a `TASKS_CLEARED` kind, structurally identical
        to `LIST_CLEARED` (`src/lib/notifications.ts`'s
        `recordListClearedTransition` — the household's open-task count
        crossing from >0 to 0) — same dedup/push/bell-icon pattern, so it's
        cheap to add later. Needs its own small migration (new enum value).

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
      github` since 2026-10-04, from v0.47.6 on), so this is unblocked
      but needs someone with push access to tags. `release.yml` tags `vX.Y.Z`
      and creates a GitHub Release. Versions cut in-PR under the
      `ci_gate: local` stopgap got neither, so they exist only in
      `package.json` and `releases.json`. For each one below, tag the
      squash-merge commit on `master` that carries it, then run
      `gh release create vX.Y.Z` with the note from `releases.json`.
      No new versions join this list. Delete the item once all of them
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
- [ ] **INFRA-5. True offline support** `[!]` — PWA installability and
      push are built, but `src/lib/service-worker.js` only handles
      `push`/`notificationclick`: no `fetch` handler, no Cache API, so a
      navigation or Server Action with no network just fails. Needs a
      decision on what's safe to serve stale (e.g. inventory counts, a
      shopping list in a store with bad signal — the strongest use case)
      vs. what must always be fresh (auth, money).
