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

Parallel-safe except where noted. **File conflicts to watch:**
AUTO-2b (c), AUTO-4 and AUTO-5 all edit
`src/components/shopping/shopping-list-client.tsx` — run them sequentially or
in one branch. SCALE-F conflicts with SCALE-J (both touch
`src/app/dashboard/budget/page.tsx`).

### Shopping list & inventory automation

- [ ] **AUTO-2b. Auto-categorize: what's left after AUTO-2**
      — `src/lib/inventory/category-resolver.ts`,
      `src/app/dashboard/meal-planning/{recipe,cooking}-actions.ts`,
      `src/components/shopping/shopping-list-client.tsx`
      AUTO-2 shipped the deterministic part: household memory, the
      bilingual dictionary and Open Food Facts categories, wired into every
      inventory and shopping-list create path (see REQUIREMENTS.md, "Data
      model" → Auto-categorization). Still open:
      (a) **AI fallback (optional)**. Only when memory and the dictionary
      both miss and a key is configured: batch the unknown *names only* into
      one small classification call through the existing provider chain,
      constrained to `AUTO_CATEGORY_KEYS`. Must not block the add: commit the
      item as "Uncategorized" immediately, then patch the category when the
      call returns (or leave it if the call fails). Rate-limited.
      (b) **Recipe-ingredient find-or-create** still writes
      `"Uncategorized"`. Use `createCategoryResolver` there, but only once
      SCALE-B/SCALE-D batch those lookups, so it doesn't add a query per
      ingredient.
      (c) **Tappable category chip on shopping-list rows**, to correct a
      guess in place. The category is already on each row (AUTO-3's
      `ShoppingListItemRow.category`, sourced from the linked
      `InventoryItem`) — this just needs the chip UI to edit it there.

- [ ] **AUTO-4. Prices fill themselves in**
      — `src/app/dashboard/shopping-list/actions.ts`,
      `src/app/share/shopping-list/actions.ts`,
      `src/components/shopping/shopping-list-client.tsx`
      **Problem:** `lastKnownPrice` is never written, `estimatedPrice` has
      no UI, so the automatic Groceries expense on list completion is 0 in
      practice unless a receipt was scanned.
      **Design brief:** each row shows a muted "≈ 24 kr" when a price is
      known, and the list header shows a running estimated total (Listonic
      does this). Tapping a price lets you correct it inline. Receipt scan
      stays the way to record *actual* prices; this just means the estimate
      is never empty.
      **Dev notes:** (1) start maintaining `InventoryItem.lastKnownPrice`
      wherever a `PriceHistory` row is written (the four
      `tx.priceHistory.create` call sites in the two actions files above —
      set it in the same transaction). (2) When a shopping-list item is
      created with a linked inventory item that has a `lastKnownPrice`,
      default `estimatedPrice` to it (per-unit semantics: keep matching how
      `completeShoppingListAction` already sums `estimatedPrice`
      unmultiplied — document the choice either way). A one-off backfill of
      `lastKnownPrice` from the latest `PriceHistory` row per item can ship
      as a data migration or be skipped (the value fills in naturally on
      the next purchase). Money formatting via the existing budget
      `Intl.NumberFormat` convention.

- [ ] **AUTO-5. Declutter the list header; finish the trip in one gesture**
      — `src/components/shopping/shopping-list-client.tsx`
      **Problem:** ~10 header buttons; completing a list is a separate,
      confirm-gated step after you've already checked everything off.
      **Design brief:** visible: the smart add line (`SmartAddBar`), "Scan
      receipt", and the overflow `⋯` menu. Everything else — import,
      export, share, add low-stock, resolve mappings, archive, delete —
      moves into the menu (delete stays visually destructive there). When
      the last pending item is checked, the existing "cleared" state
      (the "cleared" state from the archived Joy Gap backlog, item 1) gains a primary "Done shopping" button that completes
      the list without a second confirm dialog, with an "Undo" on the toast
      instead (see Guardrails). The existing "Complete list" path stays in
      the menu for completing with items still pending.
      **Dev notes:** undo needs an `uncompleteShoppingListAction` that
      restores `ACTIVE` and deletes the Groceries `Transaction` created by
      that completion — idempotent, household-scoped, same shape as
      `undoMarkMealEntryCookedAction`. Return the created `Transaction` id
      from `completeShoppingListAction` so undo targets exactly that row.
      Use Base UI `DropdownMenu` with the `render` prop (never `asChild`).

### Performance & security

- [ ] **SCALE-D. Batch the recipe-graph fetch in `expandRecipeIngredients`** —
      `src/app/dashboard/meal-planning/recipe-expansion.ts` (`expandRecipeIngredients`). This recursively calls
      `prisma.recipe.findUnique` once per recipe node (including once per sub-recipe
      component), so a meal plan with N entries each pulling in sub-recipes issues roughly
      N×(1+number of components) queries. Since a household's total recipe count is small
      and bounded, change this to fetch the household's entire recipe graph once per call
      into this module (all recipes + their `ingredients`/`components` for the household,
      via `prisma.recipe.findMany({ where: { householdId }, include: { ingredients: {
      include: { inventoryItem: true } }, components: { select: { componentRecipeId: true,
      quantity: true } } } })`) into an in-memory `Map<recipeId, Recipe>`, then have the
      existing recursive expansion walk that in-memory map instead of hitting Prisma per
      node. This needs `householdId` threaded into `expandRecipeIngredients` (it isn't a
      parameter today — check every call site, both in `cooking-actions.ts`'s preview
      actions) since the map must be scoped per-household. Keep the existing
      `MAX_COMPONENT_DEPTH`/`ancestry` cycle-guard logic unchanged — this is purely about
      where the data comes from, not the recursion/cycle logic. Verify with `npm run lint`,
      `npx tsc --noEmit`, `npm run test`.

- [ ] **SCALE-F. Bound the budget transactions query to a period instead of fetching all-time** —
      `src/app/dashboard/budget/page.tsx` (~line 86). `prisma.transaction.findMany({ where: {
      householdId: household.id }, ... })` fetches every transaction the household has ever
      logged, unbounded — this grows every month a household keeps using the app,
      independent of total user count, and will eventually slow down every load of this
      page. Default the query to the current calendar month (mirror the precedent already
      set by `src/app/dashboard/budget/export/route.ts`, which scopes its CSV export to the
      current calendar month) and add a way to navigate to a different month (prev/next
      month controls, or a month picker — check whether `budget/page.tsx` already has any
      period-related UI state before designing new UI from scratch). Check whether any
      other logic on this page (summary totals, safe-to-spend calc, recurring-template
      status) depends on seeing *all* transactions rather than just the selected month's —
      if so, either give that logic its own narrower query or flag it back rather than
      silently changing its behavior. This one has a product-facing UI surface, not just a
      backend change — if the exact navigation UX is ambiguous, make a reasonable call and
      flag it rather than guessing indefinitely. Add English + Swedish copy for any new UI
      text (`src/lib/i18n/dictionaries/en.ts` / `sv.ts` — `satisfies Dictionary` fails the
      build if a key is missing in either). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, and a manual check in the browser that a household with transactions
      across multiple months still shows the right ones per month.

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

### Performance & security

- [ ] **SCALE-G. Add composite indexes for date/expiry range queries** —
      `prisma/schema.prisma`. `Transaction` is indexed on `householdId` and `categoryId`
      separately, but budget queries filter by `householdId` *and* order/filter by `date`
      (see SCALE-F); `InventoryItem` is indexed on `householdId` but the
      "expiring soon" query (`src/lib/notifications.ts`'s `syncExpiringSoonNotifications`)
      filters by `householdId` *and* `expiresAt`. Add `@@index([householdId, date])` to
      `Transaction` and `@@index([householdId, expiresAt])` to `InventoryItem`, generate the
      migration (`npx prisma migrate dev` locally, name it descriptively), and confirm
      `npx prisma migrate deploy` would apply cleanly. No application code changes needed —
      this is a schema/migration-only task. Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`.

- [ ] **SCALE-H. Invalidate JWT sessions on password change** — currently, `resetPasswordAction`
      (`src/lib/actions/auth.ts:318`) and `updatePasswordAction`
      (`src/app/dashboard/profile/actions.ts:124`) both update `passwordHash` but do nothing
      to the JWT session model (`src/lib/auth.config.ts` — `session: { strategy: "jwt" }`),
      so a stolen session cookie survives a password reset/change. This is a known,
      previously-documented gap (see `docs/archive/PRODUCTION_READINESS.md`'s task K note) — this task
      closes it. Concrete design (already worked out, follow it rather than redesigning):
      1. Add `passwordChangedAt DateTime?` to `User` in `prisma/schema.prisma` +
         migration.
      2. In `resetPasswordAction` and `updatePasswordAction`, set
         `passwordChangedAt: new Date()` in the same `prisma.user.update` call that sets
         `passwordHash` (both already do exactly one such update — find it and add the
         field).
      3. In `src/lib/auth.ts`'s `authorize()` callback, the `user` row is
         already fetched in full from Prisma — include `passwordChangedAt` in the object
         returned to NextAuth (currently just `{ id, email, name }`) so it's available to
         the `jwt` callback at sign-in.
      4. In `src/lib/auth.config.ts`'s `jwt` callback, stash it:
         `if (user) token.pwdChangedAt = user.passwordChangedAt?.getTime() ?? null;`
         alongside the existing `token.id = user.id`. This config is shared by both the
         Edge-safe `proxy.ts` and the full `auth.ts` — this is fine since it only *reads*
         the `user` object NextAuth already gives it, no new Prisma call in the Edge path.
      5. In `src/lib/session.ts`'s `requireHousehold` and `requireUserId` (both already run
         Node-side with Prisma access — `requireHousehold` already queries the DB, so this
         adds no *new* query there; `requireUserId` currently does zero DB queries, so this
         does add one there), after `auth()` returns a session, fetch the user's current
         `passwordChangedAt` and compare it against `token.pwdChangedAt` from the session
         (`session.user` needs `pwdChangedAt` piped through the `session` callback in
         `auth.config.ts` the same way `id` already is). If the DB value is
         newer than what's embedded in the token, treat it as an invalid session — call
         `redirect("/login")` exactly like the existing "no session" branches do.
      6. Existing users have `passwordChangedAt: null` — treat `null` as "never
         changed, any token is valid" (no forced logout for the entire existing user base
         on deploy).
      Add tests covering: a session issued before a password change is rejected by
      `requireHousehold`, a session issued after is accepted, and a user who has never
      changed their password (`passwordChangedAt: null`) is unaffected — matching this
      repo's existing mocked-Prisma vitest style (see `src/lib/session.test.ts` if it
      exists, otherwise create one). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`, and a manual live check: log in, reset the password
      from another tab/session, confirm the original session is now rejected on its next
      request.

### Shopping list & inventory automation

- [ ] **AUTO-6. Remember barcodes: scan = one-tap stock change**
      — `prisma/schema.prisma` (`InventoryItem`),
      `src/components/shared/barcode-scanner.tsx`,
      `src/lib/actions/barcode.ts`, `src/app/dashboard/inventory/page.tsx`
      **Problem:** barcode scanning only ever pre-fills a name; nothing is
      remembered, so it never gets faster.
      **Design brief:** a "Scan" button on the inventory page that opens
      the camera in a *continuous* mode with a two-state toggle: **Put
      away** (+1 per scan) and **Used up** (−1 per scan, with "…and add to
      list" when it hits 0). A known barcode applies instantly with a short
      toast + Undo and the camera stays open for the next item; an unknown
      barcode shows the Open Food Facts name (and category, via AUTO-2)
      with a one-tap "Add as new item" or "This is…" picker to link it to an
      existing item. The shopping-list scan button (in the smart add line) adds a
      known barcode's item to the list in one scan.
      **Dev notes:** `barcode String?` on `InventoryItem` plus
      `@@unique([householdId, barcode])` (one product per household per
      code; a second product may link the same code only by moving it).
      New `scanStockChangeAction(barcode, delta)` resolves the barcode
      household-scoped and reuses `adjustQuantityAction`'s clamping and
      `recordOutOfStockTransition` side effect (the `RESTOCKED` kind is
      retired — see `src/lib/notifications.ts` — so don't revive it here).
      REQUIREMENTS.md's barcode section currently says "nothing about a scan
      is ever persisted" — update it, and update the privacy note (still
      only digits leave the device; the barcode is now stored with the
      household's own inventory). Keep the existing "never blocks manual
      entry" fallback behavior.

- [ ] **AUTO-7. Estimated expiry from default shelf life**
      — `prisma/schema.prisma` (`InventoryItem`), `src/lib/inventory/
      expiry.ts`, bulk-create / receipt / shopping-list purchase paths
      **Problem:** only the single-item form sets `expiresAt`, so almost no
      items have one. Grocy solves this with per-product "default best
      before days".
      **Design brief:** when stock arrives (checked off a list, receipt
      registered, put-away scan) an item with a known shelf life gets an
      *estimated* expiry, shown in `ExpiryBadge` with a "≈" prefix and a
      softer style than a real date. Editing the date in the item form
      turns it into a real date. Items the user never wants tracked (salt,
      rice) can be set to "doesn't expire".
      **Dev notes:** `shelfLifeDays Int?` on `InventoryItem` (null = use
      the category default, -1 = never expires — Grocy's convention) and
      `expiresAtEstimated Boolean @default(false)`. Category defaults live
      in the item-2 category table (e.g. dairy 7, bakery 4, fresh meat 3,
      produce 5, frozen/dry/household = none). Only set an estimate when
      stock goes from 0 → >0 or the item has no expiry yet — never push a
      real (user-entered) date later. `getExpiryStatus` unchanged; the
      `EXPIRING_SOON` notification should skip or soften estimated dates
      (decide in design — recommended: include them, the notification copy
      says "probably"). This supersedes REQUIREMENTS.md's "never set by any
      bulk-add flow" rule for estimated dates only — update that text.

- [ ] **AUTO-8. An always-on household list that fills itself**
      — `prisma/schema.prisma` (`ShoppingList`),
      `src/app/dashboard/inventory/actions.ts`,
      `src/app/dashboard/shopping-list/actions.ts`, `src/lib/notifications.ts`
      **Problem:** restocking depends on remembering to press "Add low-stock
      items", and the app has no notion of *the* list — `markItemEmptyAction`
      just guesses the most recently created `ACTIVE` one.
      **Design brief:** one list per household is the default ("Next
      shop"). When any item crosses into low/out of stock — by +/- tap,
      mark-empty, "Used up" scan (AUTO-6), or mark-meal-cooked — it's added
      to the default list automatically, with a small "added automatically"
      marker (the existing `addedAutomatically` flag) and a toast with
      Undo at the moment it happens. Completing the default list
      immediately starts a fresh empty default list, so there's always one.
      Other named lists (the big monthly trip) still work as today. A
      household setting can turn auto-add off.
      **Dev notes:** `isDefault Boolean @default(false)` on `ShoppingList`
      with at most one active default per household (enforce in the
      actions; a partial unique index via raw SQL in the migration is
      optional hardening). Note `recordOutOfStockTransition` only fires on
      the crossing to 0, not into "low" — add a sibling helper (e.g.
      `addToDefaultListOnLowStock(db, householdId, itemId, prev, next)`)
      that uses `getStockStatus` to detect the in → low/out crossing, and
      call it from the same call sites `recordOutOfStockTransition` is
      already called from (they all compute prev/next quantity), so every
      path is covered once in the actions layer, not per-UI. Replace
      `markItemEmptyAction`'s "latest ACTIVE list" guess with the default
      list. Dedupe against pending items exactly as
      `generateFromLowStockAction` does. Quantity to add: keep today's
      `max(1, threshold − quantity)`, or AUTO-10's learned usual quantity
      once it exists.

- [ ] **AUTO-9. Learn the household's store order**
      — `prisma/schema.prisma`, `src/components/shopping/
      shopping-list-client.tsx`, `src/app/dashboard/shopping-list/actions.ts`
      **Problem:** AUTO-3's fixed category order won't match any real
      store. AnyList and ICA let you sort by store; asking users to
      configure it is exactly the manual work we're trying to remove.
      **Design brief:** no settings screen by default — the category
      groups gradually reorder to match the order this household actually
      checks things off in. A small "Reorder sections" affordance (drag
      handles, in the `⋯` menu) exists for anyone who wants to fix it by
      hand, and a manual order always beats the learned one.
      **Dev notes:** a small `HouseholdCategoryOrder` table
      (`householdId`, `category`, `position Float`, `manual Boolean`) or a
      JSON column on `Household` — pick whichever is simpler to migrate.
      On each `togglePurchasedAction` → purchased, record the check-off
      sequence per list session; on list completion, nudge each category's
      position toward its observed average rank (exponential moving
      average, pure helper with tests). Per-store orders are a non-goal for
      v1 (no store concept exists yet — `PriceHistory.store` is always
      null today).

---

## Phase 3 — larger items, own PR each

### Performance & security

- [ ] **SCALE-I. Move notification background-sync off the read path** —
      `src/lib/notifications.ts`. `getActiveNotifications(householdId)` currently
      calls `syncMealNotLoggedNotifications` and `syncExpiringSoonNotifications`
      synchronously on *every* call — i.e. every time a household's notification bell is
      fetched. Both scan for overdue meal-plan entries / expiring inventory items and,
      for each new one found, create a `Notification` row and fire a push notification
      (`sendPushToHousehold`) — so viewing the bell can trigger an unbounded number of
      writes and push sends on what should be a read. Change this to a scheduled job
      instead of a request-time side effect:
      1. Add a new route `src/app/api/cron/sync-notifications/route.ts` (`GET` handler)
         that iterates every household (`prisma.household.findMany({ select: { id: true }
         } })`) and runs `syncMealNotLoggedNotifications`/`syncExpiringSoonNotifications`
         for each. Protect it with a shared secret: require a `CRON_SECRET` env var and
         reject (401) any request whose `Authorization: Bearer <token>` header doesn't
         match it — unlike `/api/health`, this route both writes data and sends push
         notifications, so it must not be publicly callable. Add `CRON_SECRET` to
         `.env.example` with a short comment (mirror the existing `UPSTASH_REDIS_REST_*`/
         `VAPID_*` comment style there).
      2. Remove the two sync calls from `getActiveNotifications` — it should become a pure
         read (`prisma.notification.findMany(...)` only, no writes, no push sends), so
         opening the bell never has side effects.
      3. Document the scheduler setup in `DEPLOYMENT.md` (a new section, following its
         existing style): for Vercel, a `vercel.json` `crons` entry hitting this route
         (suggest every 15 minutes as a starting interval, note it's tunable); for
         platforms with their own scheduler (Railway, Render), the equivalent cron/
         scheduled-job config pointed at the same route with the `CRON_SECRET` header set.
      4. Add tests for the new route: rejects a missing/wrong `CRON_SECRET`, and — with a
         valid one — calls both sync functions (mock them, don't require a real DB) for
         every household returned by the household query. Match this repo's existing
         mocked-Prisma vitest style.
      Note: this changes real user-facing behavior (a new out-of-stock/expiring/
      meal-not-logged notification will now appear on a delay of up to the cron interval,
      not instantly on next bell-open) — call this out explicitly when done rather than
      treating it as a pure refactor. Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, `npm run build`, and a manual check: temporarily hit the new route
      with `curl` locally (correct and incorrect `CRON_SECRET`) and confirm the bell still
      shows existing notifications correctly with the sync calls removed from its path.

- [ ] **SCALE-J. Extend Suspense-isolated loading to `budget`/`personal-budget`/`meal-planning`** —
      `src/app/dashboard/inventory/page.tsx`, `tasks/page.tsx`, `shopping-list/page.tsx`, and
      `household/page.tsx` were refactored (2026-09-16) so the static header (title/subtitle,
      any action that doesn't need fetched data) renders immediately and the data-dependent
      list/table streams in behind `<Suspense>` with its own skeleton, instead of the whole
      page sitting behind `dashboard/loading.tsx`'s generic fallback until every query
      resolves — see those four files for the pattern (a per-request `cache()`-wrapped
      fetcher shared by however many Suspense-isolated consumers need pieces of it).
      `budget/page.tsx`, `personal-budget/page.tsx`, and `meal-planning/page.tsx` still have
      the old blocking shape, and were deliberately left out of that pass: each aggregates
      ~5 interdependent data sources into one render (safe-to-spend, settle-up, cost
      analyzer, recurring-template status, cookable-recipes, variety recap, …), so the
      "shared cached fetch behind a couple of Suspense boundaries" trick doesn't map on as
      cleanly — expect to actually think about which pieces can render independently rather
      than mechanically repeating the other four pages' diff. Coordinate with SCALE-F:
      it also touches `budget/page.tsx`, so land whichever of the two goes first, then rebase
      the other rather than resolving the conflict blind. Verify with `npm run lint`,
      `npx tsc --noEmit`, `npm run test`, `npm run build`, and a live check (the other four
      pages were verified by seeding a household through the UI and confirming no console
      errors and no layout regressions — do the same here).

### Budget component unification

Sequential: BUDGET-2 → BUDGET-3 → BUDGET-4. Together with BUDGET-5 (needs a
decision, below) this is the whole "delete `src/components/personal-budget/`"
job.

- [ ] **BUDGET-2. Merge the four "empty-array-safe" pairs** — `TransactionDialog`+
      `PersonalTransactionDialog`, `TransactionList`+`PersonalTransactionList`,
      `RecurringTemplatesPanel`+`PersonalRecurringTemplatesPanel`,
      `DueRecurringWidget`+`PersonalDueRecurringWidget`, plus `RecurringTemplateDialog`+
      `PersonalRecurringTemplateDialog` (mechanical, no members prop involved). Delete the five
      `personal-*` files; both pages import the shared component with `members={[]}`/
      `currentMemberId=""` from the personal-budget page and real values from the household
      page. This is 5 of the 7 pairs and the least risky half.

- [ ] **BUDGET-3. Merge `CategoryManager`/`AddCategoryDialog`** — needs the two create/delete actions
      injected as props (or a small per-scope action-selector) rather than empty-array
      suppression. Doesn't depend on BUDGET-2, but touches a component BUDGET-2 doesn't.

- [ ] **BUDGET-4. Merge `BudgetTabs`/`PersonalBudgetTabs`** — needs an explicit prop for which
      optional tabs exist (`costAnalyzer`/`balances` become optional `ReactNode`s the way
      `balances` already is). Also decide, before or as part of the merge, whether
      personal budget gets household's persistent "Manage categories" button next to the
      tab bar — today `PersonalCategoryManager` is only reachable from the Activity tab's
      overview panel. It may be unnecessary at personal budget's smaller scale (one
      category-bearing tab), so "not needed" is a valid answer. Land after BUDGET-3,
      since this renders `CategoryManager` inline.

### Shopping list & inventory automation

AUTO-10 includes a small migration — coordinate it with the Phase 2 queue.

- [ ] **AUTO-10. "You usually buy this about now" suggestions**
      — `prisma/schema.prisma` (`ShoppingListItem`), new
      `src/lib/inventory/repurchase-calc.ts` (+ test),
      `src/components/shopping/shopping-list-client.tsx`
      **Problem:** inventory counts drift because nobody updates them after
      every breakfast, so low-stock detection alone misses things.
      NourishMate/FoodStock-style apps predict run-outs from purchase
      rhythm instead.
      **Design brief:** a row of dismissible suggestion chips above the
      list ("Coffee · usually every 12 days", "Oat milk"); one tap adds.
      Dismissing snoozes that item until its next cycle. Never auto-added
      (Guardrails), never in the bell.
      **Dev notes:** needs a reliable purchase timestamp —
      `purchasedAt DateTime?` on `ShoppingListItem`, set/cleared by the
      toggle actions and receipt apply. `PriceHistory` alone isn't enough
      because it's only written when a price is known. Pure calc: per
      inventory item, median interval between purchases (≥ 3 purchases
      required before suggesting anything), suggest when
      `now − lastPurchase ≥ 0.85 × median` and the item isn't already
      pending. The same data can later propose a learned
      `lowStockThreshold` and usual purchase quantity (AUTO-8) — as a
      suggestion on the item, not a silent change.

- [ ] **AUTO-11. Receipt scan: auto-accept confident matches**
      — `src/components/shopping/receipt-scan-dialog.tsx`,
      `src/components/shopping/register-receipt-dialog.tsx`
      **Problem:** every scanned line is shown for review even when the
      match is obvious.
      **Design brief:** lines above a high confidence threshold are
      pre-accepted and collapsed into a "12 items matched" summary
      (expandable); only uncertain lines are shown open for review. One
      "Apply" button. Nothing is written before Apply — review still
      exists, it's just shorter.
      **Dev notes:** a second, stricter threshold alongside the current
      pre-select threshold for `findInventoryMatches`; tune against real
      receipts before shipping. Once AUTO-6 exists, receipts with EANs
      (rare in Swedish receipts, but some chains print them) can match by
      barcode exactly.

- [ ] **AUTO-12. Voice add**
      — `src/components/shopping/smart-add-bar.tsx`
      **Design brief:** a mic button in the smart add line; speech goes
      into the input as text and commits through the same path typed text
      does (`parseSmartAddInput` → `smartAddShoppingListItemsAction`) ("two
      liters of milk and eggs" → 2 l milk, eggs). Hidden entirely where the
      browser doesn't support speech recognition — coverage in installed
      iOS PWAs is inconsistent, so this is a bonus, never a required path.
      **Dev notes:** Web Speech API, feature-detected, locale from the
      household's language cookie. Needs a small word-to-number step
      ("två", "two") before `parsePastedList`. Disclose in the privacy page
      that some browsers process speech on the vendor's servers.

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

- [ ] **GAP-1. "Use it up" recipe suggestions from expiring/low stock** —
      `src/app/dashboard/meal-planning/`. Grocy's headline feature: surface
      recipes whose ingredients overlap with what's expiring soon or
      already low, instead of only listing all recipes flat. A pure helper
      (e.g. `src/lib/inventory/use-it-up-calc.ts`) that ranks a household's
      `Recipe`s by overlap with `getExpiryStatus`/low-stock `InventoryItem`
      rows, surfaced as a dismissible chip row on the Recipes tab or the
      Planner ("Chicken stir-fry uses 2 things expiring soon"). Read-only
      suggestion, never an auto-added meal-plan entry (Guardrails).

- [ ] **GAP-2. Weekly nutrition recap for the meal plan** —
      `src/app/dashboard/meal-planning/`. The per-serving nutrition fields
      (`caloriesPerServing` etc., see REQUIREMENTS.md "Recipe nutrition
      info") are captured per recipe but never aggregated. Sum the current
      week's planned entries' nutrition (skipping entries with no
      nutrition set, and freeform meals which have none) into a dismissible
      recap card mirroring `MealVarietyRecap`'s shape — a soft "here's your
      week" summary, not a goal/target tracker (no macro-goal-setting; that's
      a much bigger, opt-in feature to consider only if this gets used).

- [ ] **GAP-3. Read-only calendar feed for the meal plan + recurring bills** —
      new `src/app/api/calendar/[token]/route.ts`. Cozi's core
      differentiator is that a household's plan shows up in the calendar app
      everyone already has open. A per-household, token-scoped (not
      session-scoped, since calendar apps can't send cookies) `.ics` feed
      URL, regenerable from the Household page, listing `MealPlanEntry`
      dates/names and `RecurringTemplate` due dates. Read-only, no write-back
      from the calendar app. Needs a new random `Household.calendarFeedToken`
      column (Phase 2 migration) and a decision on whether it's on by default
      or opt-in (default off is safer — it's a shareable link with no login).

- [ ] **GAP-4. Reusable named shopping list templates** —
      `src/components/shopping/shopping-list-client.tsx`,
      `src/app/dashboard/shopping-list/actions.ts`. AnyList/Out of Milk let
      you save a list of items as a reusable template ("BBQ", "Costco run")
      distinct from AUTO-8's auto-populated default list. A
      `saveAsTemplateAction`/`createListFromTemplateAction` pair and a small
      `ShoppingListTemplate`/`ShoppingListTemplateItem` model pair (Phase 2
      migration) — copying item names onto a new `ACTIVE` list, re-resolved
      through `findOrCreateInventoryItem` the same way import/paste already
      does, so it doesn't need its own linking logic.

- [ ] **GAP-5. Per-item notes on shopping list rows** —
      `prisma/schema.prisma` (`ShoppingListItem`),
      `src/components/shopping/shopping-list-client.tsx`. AnyList lets you
      attach a note to a line ("get the ripe ones", "any brand is fine").
      Add `note String?` to `ShoppingListItem` (Phase 2 migration), an
      optional field in the smart-add/edit flow, and a muted second line
      under the item name when set. Small, low-risk, no automation/AI
      involved — a good first pick if someone wants a quick Phase 2 win.

- [ ] **GAP-6. Capture purchase store; surface a "cheapest store" insight** —
      `src/app/dashboard/shopping-list/actions.ts`,
      `src/app/share/shopping-list/actions.ts`, Cost analyzer
      (`src/app/dashboard/budget/`). `PriceHistory.store` already exists in
      the schema (see AUTO-9's dev notes: "`PriceHistory.store` is always
      null today") but nothing ever writes it — no migration needed, just
      wiring. Add an optional store name field to receipt scan/register and
      the manual price-correct flow (AUTO-4), then let Cost analyzer show,
      per item with ≥2 distinct stores on record, which was cheapest last
      time — the ICA-app-style comparison this data already supports.

- [ ] **GAP-7. Settle up: record a settlement + a Swish payment link** —
      `src/app/dashboard/budget/settle-up-calc.ts`,
      `src/components/budget/household-balances.tsx`. REQUIREMENTS.md's
      "Household expense splitting" section already flags this as
      deliberately deferred ("no 'mark as settled' persistence... a note or
      a zeroing transaction... no payment integration of any kind"). Splitwise
      covers the first half (settlement records); a Swish deep link
      (`swish://payment?data=...`, no API key needed, Sweden being this
      app's primary locale alongside `sv.ts`) covers something Splitwise
      itself doesn't for Swedish households. Do the settlement-record half
      first (small, self-contained); treat the Swish link as a follow-on
      once that's shipped and confirmed useful.

- [ ] **GAP-8. Leftover tracking from "mark meal as cooked"** —
      `src/app/dashboard/meal-planning/cooking-actions.ts`. Today marking a
      meal cooked only decrements ingredient quantities (REQUIREMENTS.md,
      "Mark meal as cooked → inventory decrement"); the extra portions a
      recipe with `servings` > the household's headcount produces just
      evaporate. An optional "servings left over" input on the mark-cooked
      dialog that creates a small `InventoryItem` (or reuses an existing
      "Leftovers" one) with an estimated 3-4 day expiry, so it shows up in
      `ExpiryBadge`/expiring-soon before it's forgotten in the fridge — a
      real food-waste gap none of the meal planners above actually close.

- [ ] **GAP-9. Price-jump alerts from existing price history** —
      `src/lib/notifications.ts`, `prisma/schema.prisma`
      (`NotificationKind`). Every price-tracking competitor (ICA, Grocy)
      surfaces unusual price changes; Squirrel already records every price
      in `PriceHistory` but never looks back at it. A new `PRICE_SPIKE`
      notification kind (Phase 2 migration, same pattern as `LIST_CLEARED`)
      fires when a newly recorded price (receipt scan or manual correction)
      is materially above that item's trailing median — this is squarely a
      "something's actually wrong" bell case per the Guardrails, not a
      dismissible in-list chip like AUTO-9/AUTO-10's suggestions.

- [ ] **GAP-10. Voice-assistant shopping list integration (Alexa/Google Assistant)** `[!]` —
      needs a product decision, not just an estimate. AnyList and Bring!
      both support hands-free "add milk to my shopping list" via Alexa/Google
      Assistant skills — materially different from AUTO-12's in-app Web
      Speech API mic button, since it requires building and maintaining a
      third-party voice-platform skill/action, account-linking OAuth, and
      ongoing certification with Amazon/Google. Belongs alongside the
      `INFRA-` items as something clearly valuable but gated on
      infrastructure/credentials only the product owner can provision, not
      on engineering effort alone.

---

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
      (AUTO-11), never applied unseen.

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
