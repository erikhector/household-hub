# Maintenance & quality backlog — 2026-09-11 audit

Source: a four-pronged audit (code quality/architecture, test coverage, dependency/config
health, product feature gaps) run 2026-09-11. Findings below are grouped into waves the same
way `PRODUCTION_READINESS.md` was — each item is scoped to be handed to an isolated
subagent in its own git worktree/branch, with enough context to act without the original
conversation. Items in the same wave touch disjoint files and can run in parallel; later waves
depend on an earlier wave's merge (noted per item) to avoid migration-numbering or
`package.json` conflicts.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to master · `[!]` blocked / needs a human decision.

Explicitly out of scope for this backlog: migrating existing forms to
`react-hook-form`/`@hookform/resolvers` — evaluated and rejected (current
`useActionState` + native `<form>` + Zod convention is intentional per
`REQUIREMENTS.md` and adequate for all but ~4 forms; not worth the ~30-47hr full-migration
cost). See conversation history if this needs revisiting later.

## Already dispatched (not listed again below)

- **Remove unused `react-hook-form`/`@hookform/resolvers` dependencies** — installed,
  zero imports anywhere in `src/`. (task chip already spawned.)
- **Add missing Prisma indexes** on `Transaction.categoryId`, `RecurringTemplate.categoryId`,
  `PersonalTransaction.categoryId`/`recurringTemplateId`, `PersonalRecurringTemplate.categoryId`,
  plus `ShoppingListItem.inventoryItemId`/`RecipeIngredient.inventoryItemId`. (task chip
  already spawned.)

## Wave 1 — independent, parallel (no shared files, no schema changes)

- [x] **A. Split `inventory-table.tsx`** — 712-line file
      (`src/components/inventory/inventory-table.tsx`) mixes pure grouping/filter logic
      (`groupKeyFor`/`groupItems` ~lines 212-238, `matchesUpdatedFilter` ~line 70) with
      presentation and several sub-components (`LastUpdatedCell`, `StockBadge`,
      `ItemActions`). Extract the pure helpers into a colocated, dependency-free
      `inventory-table-utils.ts` (unit-testable, no React import) and split
      `StockBadge`/`ItemActions`/`LastUpdatedCell` into their own files — mirror how
      the budget feature already separates pure calc (`*-calc.ts`) from presentational
      components. No behavior change; add a unit test for the extracted grouping/filter
      helpers since they currently have none.

- [x] **B. Split `meal-planning/actions.ts`** — 742-line `"use server"` file
      (`src/app/dashboard/meal-planning/actions.ts`) spans five sub-domains: recipe CRUD +
      ingredient-cycle detection (~lines 34-271), meal-entry add/delete (~273-361), recipe
      URL import (~363-416), missing-ingredients shopping-list bridge (~418-601), and
      cooked-inventory decrement (~603-742). Split into `recipe-actions.ts`,
      `planner-actions.ts`, and `cooking-actions.ts` in the same directory, matching the
      granularity `budget`/`personal-budget` already use. Update imports in every
      component/page that calls these actions. No behavior change — verify with
      `npm run lint`, `npx tsc --noEmit`, `npm run test` after.

- [x] **C. Fix `updateEmailAction` error handling** —
      `src/app/dashboard/profile/actions.ts:93-100`'s bare `catch` assumes any
      `prisma.user.update` failure means "email already taken," silently swallowing
      unrelated errors (timeout, connection drop) without calling `toFriendlyError`
      (every other catch block in this file and app-wide does). Check the error is
      actually Prisma's unique-constraint code `P2002` before returning the
      "email already exists" message; otherwise fall through to `toFriendlyError` like
      the rest of the file (see line 36-38 for the existing pattern).

- [x] **D. Test `household.ts`'s ownership/membership actions** —
      `src/lib/actions/household.ts` has several exported actions with no test coverage,
      including `removeMemberAction`, `deleteHouseholdAction`, `leaveHouseholdAction`,
      `transferOwnershipAction`, and `switchHouseholdAction` (verify current coverage
      first — some invite-related actions may also be untested). This is the file
      enforcing "only OWNER can remove/delete/transfer," "can't remove yourself,"
      "owner can't be removed," "can't leave/delete your only household." Add tests
      (matching this repo's existing mocked-Prisma vitest style) for: a CONTRIBUTOR
      calling an owner-only action (must be rejected), targeting a member/household from
      a different tenant via a forged id (must be rejected — never trust a
      client-supplied id), `transferOwnershipAction` actually swapping roles correctly
      inside its `$transaction`, and `switchHouseholdAction` no-op/rejecting a household
      id the caller isn't a member of.

- [x] **E. Test `src/lib/exchange-rate.ts`** — `fetchExchangeRate` has zero test
      coverage despite feeding receipt currency conversion (real money) into the budget.
      Add a mocked-`fetch` unit test covering: a non-OK API response, malformed JSON,
      a currency code missing from the response, and the same-currency short-circuit
      (`from === to`, case-insensitive) that should skip the network call entirely.

- [x] **F. Test `src/lib/email.ts`** — currently only exercised indirectly through
      other modules' mocks (`auth.test.ts`, `household.test.ts`). Add direct tests for
      template building and the missing-`RESEND_API_KEY` / malformed-recipient paths.

- [x] **G. Test the budget CSV export route** —
      `src/app/dashboard/budget/export/route.ts` has no test (the underlying
      `src/lib/csv.ts` helpers are tested, but the route's auth/query wiring isn't).
      Add a test verifying it's scoped via `requireHousehold()` (never a client-supplied
      household id) and returns only the current calendar month's transactions.

- [x] **H. Add boundary-value tests to existing money-calc tests** —
      `safe-to-spend-calc.test.ts` (currently 8 cases) is missing: a zero-transaction
      month, a recurring-expense category whose only transaction is dated in a future
      month, and a zero/negative recurring amount. `settle-up-calc.ts`'s tests should
      cover a split with only one member (degenerate case — no actual split) and
      floating-point accumulation drift across many small transactions. Do not move or
      rename these files (see item M below, which depends on this landing first).

- [x] **I. Add a Postgres healthcheck to `docker-compose.yml`** — the `postgres`
      service has no healthcheck, so `docker compose up -d` can report "started" before
      Postgres accepts connections, racing local dev/test startup. Add a `pg_isready`-based
      healthcheck.

- [x] **J. Sync `REQUIREMENTS.md` with actual shipped code** — the doc is stale in at
      least two places: (1) it describes PWA/offline support and a recurring-transaction
      scheduler as "not started" under a Deferred/roadmap section, but the code already
      has a working PWA install flow (`src/components/profile/install-app-card.tsx`,
      `src/lib/service-worker.js`), real push notifications
      (`src/lib/push.ts`, VAPID/web-push), and a `RecurringTemplate`/
      `RecurringTemplateAck` due/posted/acknowledged system — document what's actually
      built instead. (2) The "Data export (CSV)" section names a component
      `ExportCsvButton`/`export-csv-button.tsx` that doesn't exist — the real file is
      `src/components/export/export-button.tsx`; fix the reference. Read the whole file
      before editing — it's ~1400 lines and other sections may have drifted too; only
      cross-check sections you can verify against current code, don't guess.

## Wave 2 — sequential (touches `package.json`/`package-lock.json`)

Run after the already-dispatched "remove react-hook-form" task merges, to avoid a
`package.json`/`package-lock.json` conflict.

- [x] **K. Upgrade vitest 3.2.7 → 5.0.0** — resolves the moderate `@vitest/mocker`
      path-traversal vulnerability (`npm audit`) cleanly; vitest 5 pins
      `@vitest/mocker@5.0.0`, past the fix range. `vitest.config.ts` is minimal (node
      env, tsconfig-paths plugin only) so migration risk looks low, but check the v4/v5
      changelog for breaking config/API changes before bumping. Run the full suite
      (`npm run test`) after and confirm all existing tests still pass unmodified where
      possible.

## Wave 3 — sequential (touches `prisma/schema.prisma`)

Run after the already-dispatched "add missing Prisma indexes" task merges, to avoid a
migration-numbering conflict (same reasoning `PRODUCTION_READINESS.md`'s Wave 2 used).

- [x] **L. Add expiry/best-before date tracking** — `InventoryItem` has no expiry
      field today. Add an optional `expiresAt` (`DateTime?`) to `InventoryItem` in
      `prisma/schema.prisma` + migration. Surface "expiring soon" (e.g. within 3 days)
      as a visual indicator in the inventory list/table, alongside the existing
      low-stock indicator. Add the field to the add/edit item form (optional, defaults
      to unset). Reuse the existing `Notification`/push infrastructure
      (`src/lib/notifications.ts`/`src/lib/push.ts` — check how the existing
      out-of-stock/meal-not-logged triggers are wired) to add a new "item expiring soon"
      trigger — match the existing trigger pattern rather than inventing a new one. Add
      both EN/SV dictionary entries for any new user-facing text (see
      `src/lib/i18n/dictionaries/en.ts`/`sv.ts` — `satisfies Dictionary` will fail the
      build if a key is missing). Update `REQUIREMENTS.md`'s Data model section to
      document the new field once built (per this repo's own convention of keeping that
      file in sync with what's implemented).

## Wave 4 — sequential (touches the same calc module Wave 1 item H tests)

Run after item H (Wave 1) merges — both touch `safe-to-spend-calc.ts`/
`safe-to-spend-calc.test.ts` and `recurring-template-calc.ts`.

- [x] **M. Relocate shared budget calc modules to `src/lib`** —
      `src/app/dashboard/budget/safe-to-spend-calc.ts` and
      `.../recurring-template-calc.ts` live under the `budget` feature's route folder
      but are imported directly by the unrelated `personal-budget` feature
      (`src/app/dashboard/personal-budget/actions.ts:7`, `page.tsx:20-21`,
      `src/components/personal-budget/personal-budget-tabs.tsx:16`). Move both (and
      their `.test.ts` siblings) to `src/lib/`, update every import site in both
      features, and verify `npm run lint`/`npx tsc --noEmit`/`npm run test` all pass.
      Pure refactor — no logic change.

## Wave 5 — feature builds (independent of each other; no shared-file conflicts, run in parallel)

Each of these is a genuine feature, not a cleanup — give the agent latitude to make
reasonable UX calls the way past waves' agents did, but flag anything that reads like a
product decision rather than an implementation detail.

- [x] **N. CSV/bulk inventory import** — CSV *export* exists for inventory/shopping/budget
      (`src/lib/csv.ts`), but there's no import path anywhere. The recent bulk-stocking
      work already added a paste-list parser and scan queue to the inventory feature
      (see recent commits/`src/components/inventory/` for the paste-list import UI) —
      extend that same ingestion path to also accept a CSV file upload for initial
      inventory setup, reusing its parsing/preview/confirm flow rather than building a
      new one. Scope to inventory only (not shopping-list/budget import) for this pass.

- [x] **O. One-tap "log it" for a due recurring template** — the recurring-transaction
      scheduler groundwork already exists: `recurring-template-calc.ts`'s
      `getPeriodKey`/`computeTemplateStatuses` derives per-period due/posted/acknowledged
      state (see Wave 4 note above — coordinate if both land close together). Add a
      button on a "due" template's card that pre-fills and submits the matching
      `Transaction` (amount/category/date from the template) in one click, instead of
      the user re-entering it by hand via `TransactionDialog`. Keep the existing
      "acknowledge without logging" path working unchanged.

- [x] **P. Recipe nutrition fields (manual entry only)** — add optional per-recipe
      nutrition fields (e.g. calories, protein/carbs/fat — confirm exact field set is
      reasonable, don't over-build) to `Recipe` in `prisma/schema.prisma` + migration,
      editable in `RecipeFormDialog` and displayed on the recipe view. Manual entry
      only for this pass — do NOT integrate a USDA/Edamam nutrition-lookup API; that's
      a separate, larger task needing its own SSRF-safe-fetch review (like the existing
      recipe-URL-import feature) and is out of scope here.

- [x] **Q. Scoped view-only share link for a single shopping list** — decisions made
      (check-off allowed, no login required, manual revoke only). Implemented as
      `ShoppingListShareLink` + a public `/share/shopping-list/[token]` page, with the
      unauthenticated `toggleItemViaShareTokenAction` re-validating the itemId belongs
      to the token's own list as the real security boundary. Live-verified: create
      link, view + check off with no session, revoke, confirm revoked link stops
      working.

- [x] **R. Accessibility pass** — audited form labeling, sonner toast live-region
      announcements, and keyboard-trap/dismissal behavior on the barcode-scanner and
      receipt-scan dialogs. Found and fixed 10 genuine icon-only-button/unlabeled-input
      gaps (transaction split amounts, invite/share link fields, bulk-add review rows,
      the quick-add bar's bare spans, inventory bulk-edit controls, several delete
      buttons, and a completely unused pause/resume aria-label). Toasts and both camera/
      OCR dialogs were already correct out of the box (sonner's default `aria-live`,
      Base UI's default focus trap + Escape) — verified against the installed library
      source and live in the browser, not assumed. 14-file, +67/−7 diff, all
      attribute-level, no layout/logic changes.

## Notes for any agent resuming a task after an interruption

Follow `PRODUCTION_READINESS.md`'s own convention: each task's worktree should get its
own `AGENT_PROGRESS.md` at its root reflecting true current progress and next steps, for
anyone (human or agent) resuming after an interruption.
