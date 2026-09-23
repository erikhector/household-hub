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
AUTO-1, AUTO-3, AUTO-4 and AUTO-5 all edit
`src/components/shopping/shopping-list-client.tsx` — run them sequentially or
in one branch (build AUTO-1 first; it uses AUTO-2's category lookup,
which has shipped). AUTO-2b (c) belongs with AUTO-3. SCALE-F conflicts with SCALE-J (both touch
`src/app/dashboard/budget/page.tsx`). SCALE-C and AUTO-4 both touch the
receipt-apply path in `src/app/dashboard/shopping-list/actions.ts`.

### Shopping list & inventory automation

- [ ] **AUTO-1. Smart add line on the shopping list**
      — `src/components/shopping/shopping-list-client.tsx`, new
      `src/components/shopping/smart-add-bar.tsx`,
      `src/app/dashboard/shopping-list/actions.ts`
      **Problem:** the everyday "add milk" task goes through a modal with
      four-plus fields. Competitors (AnyList, Bring!, Apple Reminders) make
      it a single text line with autocomplete.
      **Design brief:** a single always-visible input at the top of an
      `ACTIVE` list (sticky on mobile). Typing `2 l mjölk, bröd, 6 ägg` and
      pressing Enter adds three items, quantity/unit parsed out. Autocomplete
      dropdown under the input, ranked: items on this household's inventory
      that are currently low/out → items previously bought (by recency) →
      other inventory items. Picking a suggestion commits it in one tap with
      that item's usual unit. After commit the input clears and keeps focus
      for the next item (same rhythm as `QuickAddBar`). Each added row
      briefly highlights so the user sees where it went. The existing
      `ShoppingItemFormDialog` stays for *editing* a row (and for the
      advanced link/create choices), but is no longer the primary add path.
      **Dev notes:** reuse `parsePastedList`
      (`src/lib/inventory/parse-pasted-list.ts`) — it already splits on
      commas/lines and understands Swedish + English units ("Mjölk 1 l",
      "Ägg 12 st", "2 cans tomatoes"); don't write a second parser. Commit
      through one new batch action (or a loop over
      `quickAddShoppingListItemAction`) that uses the existing
      find-or-create inventory linking and the same pending-item dedupe
      `generateFromLowStockAction` uses (adding "milk" when milk is already
      pending bumps nothing and shows a "already on the list" hint rather
      than a duplicate row). Matching to existing inventory should use
      `findInventoryMatches` (`src/lib/item-matching.ts`) above a confident
      score before falling back to case-insensitive exact-name
      find-or-create, so "Mjölk" and "mjölk 3%" converge on one item. When
      creating a new inventory item, get its category from AUTO-2's
      `createCategoryResolver` (`src/lib/inventory/category-resolver.ts`). Autocomplete
      ranking data (inventory list + stock status) is already loaded by the
      page for `inventoryItems`; extend that query rather than adding a
      client fetch. i18n: new `shoppingList.smartAdd` namespace in `en.ts`/
      `sv.ts`. Pure ranking helper in its own `*.ts` with a unit test.
      **Non-goal:** voice input (AUTO-12) — but build the commit path so
      voice can feed the same parser later.

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
      guess in place. Build it with AUTO-3, which adds the category to each
      row.

- [ ] **AUTO-3. Shopping mode: group the list by category**
      — `src/components/shopping/shopping-list-client.tsx`
      **Problem:** a flat list in insertion order means zig-zagging the
      store. Every major competitor groups by aisle/section.
      **Design brief:** pending items grouped under category headers (the
      linked inventory item's category), purchased items still collapse
      into the "Purchased" section below. Larger tap targets on rows while
      the list is `ACTIVE`, and the whole row (not just the checkbox) toggles
      purchased. Keep the screen awake while a list is open on a phone
      (Screen Wake Lock API, feature-detected, silently skipped where
      unsupported — no permission prompt involved). Group order in this
      wave is a fixed sensible default (produce → bakery → dairy → meat →
      dry goods → frozen → household → other; `AUTO_CATEGORY_KEYS` in
      `src/lib/inventory/auto-category.ts` is already in that order);
      AUTO-9 makes it learn.
      **Dev notes:** needs the linked `InventoryItem.category` on each row
      — extend the `[id]/page.tsx` query's `include`. Grouping/sort is a pure
      helper with a unit test. Items without a category group under
      "Other" at the end. Wake Lock stores nothing, so no cookie-inventory
      entry needed.

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
      **Design brief:** visible: the smart add line (AUTO-1), "Scan
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

- [ ] **SCALE-A. Batch the per-row inventory lookup in `addMissingIngredientsToShoppingListAction`**
      — `src/app/dashboard/meal-planning/cooking-actions.ts` (the per-row loop, ~line 214). The `for (const row of
      rows)` loop calls `findOrCreateInventoryItem(household.id, row.name)` (a query, and
      sometimes a create) followed by a separate `shoppingListItem.create`, once per row —
      2 round trips per ingredient instead of a single batched pass. Change it to: one
      `findOrCreateInventoryItem`-equivalent batch lookup (`prisma.inventoryItem.findMany({
      where: { householdId, name: { in: rows.map(r => r.name) } } })` to find existing
      matches in one query, then a single `createMany` for the names that don't already
      exist), followed by a single `shoppingListItem.createMany` for every row not already
      on the list (the existing `alreadyOnListIds` dedupe logic must still apply). Preserve
      current behavior exactly (same dedupe against `alreadyOnListIds`, same
      `addedAutomatically: true` flag). Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`.

- [ ] **SCALE-B. Batch ingredient/component resolution in recipe save** —
      `src/app/dashboard/meal-planning/recipe-actions.ts`. Two separate N+1 patterns in the
      same file: `parseIngredientRows` (~line 75) runs `Promise.all(rows.map(...
      findOrCreateInventoryItem...))` — N parallel query pairs for N ingredients — and
      `parseComponentRows` (~line 140) runs a sequential `for` loop doing
      `prisma.recipe.findFirst` + `wouldCreateCycle` per component row — N sequential round
      trips for N components. Batch `parseIngredientRows` the same way as SCALE-A (one
      `findMany` + one `createMany` instead of N lookup/create pairs, preserving
      insertion order for the returned `data` array). For `parseComponentRows`, replace the
      per-row `prisma.recipe.findFirst` with a single `prisma.recipe.findMany({ where: { id:
      { in: ids }, householdId } })` up front, then look up each id from an in-memory Map
      inside the loop — but leave `wouldCreateCycle`'s per-row call as-is (it's a graph
      check, not a flat lookup; don't attempt to batch it in this task). Verify with
      `npm run lint`, `npx tsc --noEmit`, `npm run test`.

- [ ] **SCALE-C. Batch shopping-list mapping resolution and receipt-scan apply** —
      `src/app/dashboard/shopping-list/actions.ts`. Two separate loops issue 2-3 DB writes
      per item inside a `$transaction`: `resolveShoppingListMappingsAction`
      loops over `resolutions` doing a conditional `inventoryItem.findFirst`/`create` plus a
      `shoppingListItem.update` per item, and `applyReceiptScanAction` loops
      over `validMatches` doing a `shoppingListItem.update` plus a conditional
      `inventoryItem.update` and `priceHistory.create` per match. In both cases the target
      rows already exist in the `items`/`itemsById` map fetched before the transaction — the
      writes are what's per-row, not the reads, and each row's write data differs, so this
      can't collapse into a single `updateMany`. Instead, parallelize the per-row writes
      inside each transaction with `Promise.all` (Prisma's interactive `$transaction`
      callback supports concurrent queries on the same `tx` client) instead of sequential
      `await`s in a `for` loop, cutting wall-clock transaction hold time roughly in half to a
      third depending on the row. Do not change the actual data written or the dedupe/
      validation logic — this is purely reducing sequential round trips within the existing
      transaction. Verify with `npm run lint`, `npx tsc --noEmit`, `npm run test`.

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

- [ ] **SCALE-E. Rate-limit `sendInviteEmailAction`** —
      `src/lib/actions/household.ts` (`sendInviteEmailAction`). This lets any authenticated household member
      trigger an outbound email to an arbitrary address with no throttle — a cost/abuse
      vector (spamming arbitrary inboxes via this app's sending domain) once there are many
      real accounts. Mirror the existing pattern in the same file
      (`JOIN_SIGNUP_RATE_LIMIT`/`JOIN_SIGNUP_RATE_LIMIT_WINDOW_MS`, and the
      `checkRateLimit` call in the join-signup action): add a rate limit keyed on the *sender*
      (`invite-email:${household.userId}` — use whatever identifier `requireHousehold()`
      returns for the acting user) of something like 10 invite emails per hour, returning
      `{ error: "Too many invite emails sent. Please wait a while and try again." }` when
      exceeded. Add a test in this file's existing test suite covering both the
      under-limit and over-limit cases (see `src/lib/actions/household.test.ts`'s existing
      style). Verify with `npm run lint`, `npx tsc --noEmit`, `npm run test`.

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

- [ ] **BUDGET-1. Quick-win catch-up patches** — bring the personal-budget tree up to
      the conventions the household tree already follows, without waiting on the
      structural merge in Phase 3. Lowest risk, and not invalidated by whatever the
      unification ends up looking like. Checked against the code on 2026-09-23 — the
      shared `Tabs` catch-up has already landed in `personal-budget-tabs.tsx`; what's
      left:
      - `personal-transaction-dialog.tsx` still uses a native
        `<input type="checkbox">` — switch to the shared `Checkbox`
        (`src/components/ui/checkbox.tsx`).
      - `personal-category-manager.tsx`'s empty state is a bare muted `<p>` — use the
        shared dashed-box convention (`rounded-md border border-dashed p-8 text-center
        text-sm text-muted-foreground`, as `category-manager.tsx` does).
      - `deletePersonalCategoryAction` (`src/app/dashboard/personal-budget/actions.ts`)
        calls `prisma.personalBudgetCategory.delete` with no `try/catch`, unlike the
        household `deleteCategoryAction` — wrap it in `toFriendlyError` so a race (the
        category gaining a transaction between check and delete) returns a friendly
        `ActionState.error` instead of throwing.

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
      existing item. The shopping-list scan button (AUTO-1's bar) adds a
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
AUTO-12 depends on AUTO-1.

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
      — `src/components/shopping/smart-add-bar.tsx` (AUTO-1)
      **Design brief:** a mic button in the smart add line; speech goes
      into the input as text and commits through AUTO-1's parser ("two
      liters of milk and eggs" → 2 l milk, eggs). Hidden entirely where the
      browser doesn't support speech recognition — coverage in installed
      iOS PWAs is inconsistent, so this is a bonus, never a required path.
      **Dev notes:** Web Speech API, feature-detected, locale from the
      household's language cookie. Needs a small word-to-number step
      ("två", "two") before `parsePastedList`. Disclose in the privacy page
      that some browsers process speech on the vendor's servers.

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
