# Backlog

The single list of open work for Squirrel. Everything here is **not built
yet**; everything already shipped is documented in
[REQUIREMENTS.md](./REQUIREMENTS.md), and the planning docs that produced it
are kept for their design rationale in [`docs/archive/`](./docs/archive/)
(code comments still cite them by item).

**Picking an item:** take the lowest phase you can. Within Phase 1, anything
can run in parallel except the file conflicts listed at the top of that phase. Phase 2
items each add a Prisma migration, so land them **one at a time**, each
rebased on the previous one's merge, to avoid migration-ordering conflicts.
Phase 3 items are large enough to deserve their own PR. The last section
needs a human decision before anyone builds anything.

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

- [ ] **SEC-2. Close the DNS-rebinding hole in recipe import** (medium) —
      `assertResolvesToPublicAddress` (`src/lib/recipe-import.ts:798-812`)
      resolves the host, then `fetch` (`:873`) resolves it again, so a TTL-0
      record can point the real request at `127.0.0.1`/`169.254.169.254`.
      Pin the connection with an undici `Agent` whose `connect.lookup`
      re-validates every resolved address; keep the abort timer running
      through `readBodyWithLimit` (it's cleared before the body is read);
      add `checkRateLimit("recipe-import:<householdId>")` (~20/h) to the
      action in `meal-planning/recipe-actions.ts:420`. Test: mocked
      `dns.lookup` returning public-then-private never connects.
- [ ] **SEC-3. Validate push subscription endpoints** (medium) —
      `subscribeToPushAction` (`src/lib/actions/push.ts:30-40`) stores any
      `endpoint`/keys, and `sendNotification` (`src/lib/push.ts:115`) later
      POSTs to it: blind SSRF into internal hosts, plus unbounded rows per
      user slowing every fan-out. Zod: `https:` URL ≤1024 chars on an
      allowlist of push services (FCM, Mozilla, WNS, Apple), base64url keys
      of the right length, ≤10 subscriptions per user; pass
      `{ timeout: 10_000 }` to `sendNotification`.
- [ ] **SEC-5. Drop push subscriptions on password reset/change and logout** (low-medium) —
      SCALE-H's session revocation doesn't cover `PushSubscription`, so
      someone who briefly had the account keeps receiving household pushes.
      `deleteMany({ where: { userId } })` inside the reset
      (`auth.ts:425-446`) and change-password (`profile/actions.ts:238-249`)
      transactions; unsubscribe the current endpoint in `logoutAction`.
- [ ] **SEC-7. Cap input sizes** (low) — the 6 MB `bodySizeLimit`
      (`next.config.ts:122`) applies to every action, not only photo scans,
      and several schemas have no caps: recipe ingredient rows
      (`recipe-actions.ts:42-44`, each find-or-creates an inventory item),
      `registerReceipt` items/quantity/price
      (`shopping-list/actions.ts:1505-1520`), cooked-ingredient name/unit/
      quantity (`cooking-actions.ts:190-196`), `bulkUpdateFieldAction` ids
      (`inventory/actions.ts:723`), `componentRecipeId` rows. Add `.max()`
      and count caps mirroring existing constants (`MAX_TEMPLATE_ITEMS`).
      Test: 1,001 ingredient rows are rejected.
- [ ] **SEC-8. Single-use tokens that are actually single-use, and hashed** (low) —
      invite accept (`household.ts:169,245`) and password reset
      (`auth.ts:435`) check the token, then update by `id`, so two
      concurrent requests can both redeem it. Use
      `updateMany({ where: { id, usedAt: null } })` and abort on
      `count === 0`. Store reset/verification tokens as `sha256(token)` so a
      read-only DB leak isn't an account takeover (invalidates tokens in
      flight — fine, they live an hour).
- [ ] **SEC-10. Complete the personal data export** (low) —
      `src/app/dashboard/profile/export-data/route.ts` omits push
      subscriptions, `locale`/`theme`/`weeklyDigestEnabled`, notes, task
      history, splits and settlements; exports `categoryId` without the
      categories; and sends no `Cache-Control: private, no-store`.
      Snapshot-test the export's keys.
- [ ] **SEC-11. Don't log raw AI output** (low) — on a JSON parse failure
      `receipt-scan.ts:211` and `inventory-scan.ts:291` log the whole model
      response, which for receipts can include card/loyalty details. Log
      length + first ~200 chars. (Lands naturally with MAINT-8.)
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

- [ ] **PERF-5. Stop sending the whole dictionary through the dashboard layout** (medium, S) —
      `dashboard/layout.tsx:95-106` passes the full `dict` (87 KB JSON) to
      the client `Sidebar`, `HouseholdSwitcher` and `BottomNav`, which use
      ~7.6 KB of it; it's inlined into every dashboard document and
      layout-re-rendering action response. Pass `Pick<Dictionary, …>`
      sub-objects (AGENTS.md already asks for this).
- [ ] **PERF-7. Keep zod out of the meal-planning client bundle** (medium, S) —
      `src/lib/recipe-tags.ts:20,43` imports `zod` for one `z.enum`, pulling a
      99 KB gz chunk into `recipe-manager.tsx`/`recipe-form-dialog.tsx`.
      Split the zod-free helpers (`RECIPE_TAGS`, `isRecipeTag`,
      `recipeMatchesTag`) from the server-side schema. Expect meal-planning
      ~472 → ~375 KB gz.
- [ ] **PERF-8. Shrink Sentry in the root bundle** (medium, S) — the static
      import in `src/instrumentation-client.ts:1` puts ~130 KB gz on every
      page (incl. `/login`) even with no DSN. Add `bundleSizeOptimizations`
      (`excludeDebugStatements`, `excludeTracing` — `tracesSampleRate` is 0 —
      and the replay excludes) to `withSentryConfig`, or `import()` it
      behind the DSN check.
- [ ] **PERF-9. Move pushes and price-spike checks into `after()`** (medium, S) —
      `void sendPushToHousehold(...)` (`notifications.ts:293,336`) can be
      dropped when Vercel freezes the function after the response (the
      comment in `push.ts:35-48` admits it), while `recordPriceSpikes`
      (3 queries + awaited push) is *awaited* on the check-off path
      (`shopping-list/actions.ts:1095,1286,1480,1742`,
      `share/shopping-list/actions.ts:196`). Use `after()` from
      `next/server` for both, as `category-resolver.ts:79` already does.
- [ ] **PERF-10. Configure the pg pool for serverless** (medium, S) —
      `src/lib/prisma.ts:8` uses pg defaults (`max` 10, no idle handling)
      while the budget page alone fires 14 parallel queries. Set `max` and a
      short `idleTimeoutMillis`, add `attachDatabasePool(pool)` from
      `@vercel/functions` on Fluid compute, and confirm `DATABASE_URL`
      points at the pooler (DEPLOYMENT.md §3).
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
- [ ] **PERF-14. Small sequential-await and over-fetch fixes** (low, S) —
      `dashboard/page.tsx:72-77` (`myTasks` waits on the `Promise.all`; filter
      by `assignedTo.userId` and run it in parallel); `dashboard/page.tsx:52`
      (full inventory rows just to count them — `select`);
      `personal-budget/page.tsx:138-158` (two queries per membership — batch
      with `householdId: { in }`); `meal-planning/page.tsx:57`
      (`include: { recipe: true }` pulls instructions — `select`).

### Maintainability (2026-09-26 audit)

Baseline at audit time: lint clean, `tsc` clean, 104 test files / 1,860
tests passing, no `any`/`@ts-ignore` in app code. Items 3, 5, 6 and 7 all
touch `shopping-list/actions.ts` — land MAINT-2 → MAINT-5 → MAINT-6 → MAINT-3,
then MAINT-7 per feature, to avoid churn.

- [ ] **MAINT-2. No `householdId`-taking exports from `"use server"` files** (high, S) —
      `findOrCreateGroceriesCategory(householdId)`
      (`dashboard/budget/actions.ts:39`) and
      `isHouseholdStepSkipped(householdId)` (`lib/actions/household.ts:303`)
      are exported from `"use server"` modules, so they're potential
      client-callable endpoints that take a household id — the one thing
      AGENTS.md says never to accept from the client. Move them to plain
      server modules, and add a test that every `"use server"` export ends
      in `Action` or is on a small allowlist (the token-gated
      `getShoppingListByShareToken`, `getInvitationForDisplay`).
- [ ] **MAINT-3. Split `shopping-list/actions.ts`** (medium, L) — 2,114
      lines / 29 exports, test file 2,850 lines. Follow the meal-planning
      precedent: `list-`, `item-`, `smart-add-`, `purchase-` (toggle,
      put-away), `receipt-` and `store-order-actions.ts`, tests split the
      same way. Do after MAINT-2/5/6.
- [ ] **MAINT-4. Deduplicate small server helpers** (medium, S) —
      `absoluteAppUrl` ×4 (`lib/actions/auth.ts:304`,
      `lib/actions/household.ts:62`, `profile/actions.ts:112`,
      `shopping-list/share-actions.ts:24`; `lib/email.ts:40` re-derives it)
      → `src/lib/app-url.ts`; the P2002 unique-violation check ×4 →
      `src/lib/prisma-errors.ts`; `roundMoney`, `median`, `escapeHtml` and
      three `normalizeUnit` copies in `meal-planning/` → one each; rename
      `normalizeItemName` in `inventory-scan.ts:141`, which shadows the
      different one in `lib/item-matching.ts:9`.
- [ ] **MAINT-5. Log the groceries expense in one place, inside the transaction** (medium, S) —
      two copy-pasted blocks (`shopping-list/actions.ts:1744-1763` and
      `2029-2053`) run `prisma.transaction.create` *after* the stock
      transaction and outside any try/catch, so a DB error surfaces as a
      crash after stock already moved, and a retry double-applies. Extract
      `logGroceriesExpense(...)`, run it via `tx` inside the same
      `$transaction`, wrap with `toFriendlyError`.
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
- [ ] **MAINT-9. One `useDismissedLocalStorage(key)` hook** (low, S) — the
      same `useSyncExternalStore` + localStorage code is in
      `meal-nutrition-recap.tsx`, `meal-variety-recap.tsx`,
      `use-it-up-suggestions.tsx` and `tasks-weekly-recap.tsx`. Put it in
      `src/components/shared/`, taking keys from `cookie-inventory.ts` so
      MAINT-1 can't regress. After MAINT-1.
- [ ] **MAINT-10. Split oversized UI files** (low, M) —
      `components/shopping/shopping-list-client.tsx` (1,095 lines: move
      `ShoppingRow`, `PriceTag`, `PrintableList`, `ClearedState` out, pull
      state into hooks); `dashboard/budget/page.tsx` (967 lines:
      `BudgetTabsSection` runs 10+ queries inline — extract a
      `loadBudgetTabsData()` into `src/lib/budget/`). Budget part conflicts
      with PERF-12 and BUDGET-5/6.
- [ ] **MAINT-11. Route cron/API errors through `logger` + Sentry** (medium, S) —
      12 `console.error`/`warn` calls bypass redaction and Sentry, so caught
      cron failures are invisible: `api/cron/sync-notifications/route.ts`,
      `api/cron/weekly-digest/route.ts`, `api/digest/unsubscribe/[token]`,
      `api/health`, `lib/weekly-digest.ts:328`, `lib/push.ts:124`,
      `lib/rate-limit.ts:78,129`. Use `logger.error` + `Sentry.captureException`
      tagged with `householdId`.
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

### Shopping list & inventory automation

Nothing queued right now.

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

## Needs a decision before building

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
- [ ] **INFRA-5. True offline support** `[!]` — PWA installability and
      push are built, but `src/lib/service-worker.js` only handles
      `push`/`notificationclick`: no `fetch` handler, no Cache API, so a
      navigation or Server Action with no network just fails. Needs a
      decision on what's safe to serve stale (e.g. inventory counts, a
      shopping list in a store with bad signal — the strongest use case)
      vs. what must always be fresh (auth, money).
