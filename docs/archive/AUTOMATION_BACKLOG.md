# Automation backlog — Sep 2026

Source: a product-design review of the shopping-list and inventory flows
(Sep 2026), compared against Bring!, AnyList, OurGroceries, Apple Reminders
(grocery lists), Listonic, Grocy, the ICA app, and the newer AI pantry apps
(NourishMate, FoodStock, Smart Kitchen). Its finding: Squirrel already has
*more* ways to get data in than most competitors — barcode, receipt scan,
AI shelf scan, paste-a-list, starter kit, the meal-plan bridge — but each is
a separate trip the user has to start, and the app forgets what it learned
along the way. The apps that feel like magic don't have more features; they
remember everything and fill in the blanks. The goal of this backlog is to
minimize how often a household member has to type anything at all.

Friction points found in the current code, which the tickets below address:

- Adding to a shopping list opens a modal (`ShoppingItemFormDialog`) asking
  for name, quantity, unit and an inventory link/category. Inventory has an
  Enter-to-commit `QuickAddBar`; the shopping list doesn't, even though
  `quickAddShoppingListItemAction` already exists (only receipt scan uses it).
- Every item created from a shopping list lands in category
  `"Uncategorized"`, and `ResolveMappingsDialog` then asks the user to sort
  them by hand — the system creating chores for the user.
- A scanned barcode is never persisted, so scanning the same carton for the
  20th time still round-trips Open Food Facts and only pre-fills a name.
- Restocking is a button ("Add low-stock items") the user has to remember,
  and `lowStockThreshold` defaults to 1 for everything.
- `InventoryItem.lastKnownPrice` exists but is never written anywhere (only
  read by the CSV export), and no UI sets `ShoppingListItem.estimatedPrice`,
  so a completed list usually logs a Groceries expense of 0 unless a
  receipt was scanned.
- `expiresAt` is only settable from the single-item form; every bulk flow
  deliberately skips it, so most items never get one and the
  `EXPIRING_SOON` notification rarely has anything to fire on.
- The list renders flat, in insertion order — no grouping by category/aisle.
- The list detail header carries ~10 buttons, which is a lot on a phone in
  a store aisle.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` shipped ·
`[!]` blocked / needs a decision.

## Guardrails — apply to every item below

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

---

## Wave 1 — now, no schema changes

Removes most of the day-to-day typing. Items 1 and 2 share groundwork (the
parser + category lookup), so build 1 → 2 first; 3-5 are independent after
that.

- [ ] **1. Smart add line on the shopping list**
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
      creating a new inventory item, category comes from item 2. Autocomplete
      ranking data (inventory list + stock status) is already loaded by the
      page for `inventoryItems`; extend that query rather than adding a
      client fetch. i18n: new `shoppingList.smartAdd` namespace in `en.ts`/
      `sv.ts`. Pure ranking helper in its own `*.ts` with a unit test.
      **Non-goal:** voice input (item 12) — but build the commit path so
      voice can feed the same parser later.

- [ ] **2. Auto-categorize, so "Uncategorized" stops appearing**
      — new `src/lib/inventory/auto-category.ts` (+ test),
      `src/app/dashboard/shopping-list/actions.ts` (every find-or-create
      path), `src/app/dashboard/inventory/actions.ts` (quick-add / bulk)
      **Problem:** items created from a list, a receipt or a paste land in
      `"Uncategorized"`, and `ResolveMappingsDialog` turns that into a manual
      sorting job. Apple Reminders, Bring! and AnyList all file "milk" under
      Dairy on their own.
      **Design brief:** no new UI in the happy path — items just arrive in
      a sensible category. The category chip on a row is tappable to change
      it. `ResolveMappingsDialog` remains as a fallback but should be rare.
      **Dev notes:** three-step resolution, cheapest first:
      (a) **Household memory** — if this household already has an inventory
      item whose normalized name (`normalizeItemName`) matches or
      fuzzy-matches confidently, reuse its category (this is also how a user
      correction "sticks" — see Guardrails).
      (b) **Built-in dictionary** — a bilingual keyword → canonical-category
      table (e.g. `mjölk|milk|yoghurt|ost|cheese → Dairy`), a few hundred
      common grocery words, matched on normalized name tokens. Canonical
      category keys map to localized display names via the dictionaries,
      and should line up with the starter kits' existing categories
      (`inventory.starterKits` in `en.ts`/`sv.ts`) so a
      starter-kit household and an auto-categorized one look the same.
      (c) **AI fallback (optional)** — only when (a) and (b) miss and a key
      is configured: batch the unknown *names only* into one small
      classification call through the existing provider chain, constrained
      to the canonical category list. Must not block the add: commit the
      item as "Uncategorized" immediately and patch the category when the
      call returns (or leave it if it fails). Rate-limited.
      Also use the Open Food Facts product categories when a barcode scan
      matched (`lookupBarcodeAction` currently discards them).
      Pure resolver with unit tests covering Swedish and English words,
      plural forms, and "household memory beats dictionary".

- [ ] **3. Shopping mode: group the list by category**
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
      dry goods → frozen → household → other); item 9 makes it learn.
      **Dev notes:** needs the linked `InventoryItem.category` on each row
      — extend the `[id]/page.tsx` query's `include`. Grouping/sort is a pure
      helper with a unit test. Items without a category group under
      "Other" at the end. Wake Lock stores nothing, so no cookie-inventory
      entry needed.

- [ ] **4. Prices fill themselves in**
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

- [ ] **5. Declutter the list header; finish the trip in one gesture**
      — `src/components/shopping/shopping-list-client.tsx`
      **Problem:** ~10 header buttons; completing a list is a separate,
      confirm-gated step after you've already checked everything off.
      **Design brief:** visible: the smart add line (item 1), "Scan
      receipt", and the overflow `⋯` menu. Everything else — import,
      export, share, add low-stock, resolve mappings, archive, delete —
      moves into the menu (delete stays visually destructive there). When
      the last pending item is checked, the existing "cleared" state
      (Joy Gap item 1) gains a primary "Done shopping" button that completes
      the list without a second confirm dialog, with an "Undo" on the toast
      instead (see Guardrails). The existing "Complete list" path stays in
      the menu for completing with items still pending.
      **Dev notes:** undo needs an `uncompleteShoppingListAction` that
      restores `ACTIVE` and deletes the Groceries `Transaction` created by
      that completion — idempotent, household-scoped, same shape as
      `undoMarkMealEntryCookedAction`. Return the created `Transaction` id
      from `completeShoppingListAction` so undo targets exactly that row.
      Use Base UI `DropdownMenu` with the `render` prop (never `asChild`).

---

## Wave 2 — next, one small schema change each

Makes inventory maintain itself. Independent of each other; each needs its
own migration (`npx prisma migrate dev --name <name>`, local only).

- [ ] **6. Remember barcodes: scan = one-tap stock change**
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
      barcode shows the Open Food Facts name (and category, via item 2)
      with a one-tap "Add as new item" or "This is…" picker to link it to an
      existing item. The shopping-list scan button (item 1's bar) adds a
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

- [ ] **7. Estimated expiry from default shelf life**
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

- [ ] **8. An always-on household list that fills itself**
      — `prisma/schema.prisma` (`ShoppingList`),
      `src/app/dashboard/inventory/actions.ts`,
      `src/app/dashboard/shopping-list/actions.ts`, `src/lib/notifications.ts`
      **Problem:** restocking depends on remembering to press "Add low-stock
      items", and the app has no notion of *the* list — `markItemEmptyAction`
      just guesses the most recently created `ACTIVE` one.
      **Design brief:** one list per household is the default ("Next
      shop"). When any item crosses into low/out of stock — by +/- tap,
      mark-empty, "Used up" scan (item 6), or mark-meal-cooked — it's added
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
      `max(1, threshold − quantity)`, or item 10's learned usual quantity
      once it exists.

- [ ] **9. Learn the household's store order**
      — `prisma/schema.prisma`, `src/components/shopping/
      shopping-list-client.tsx`, `src/app/dashboard/shopping-list/actions.ts`
      **Problem:** item 3's fixed category order won't match any real
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

## Wave 3 — later, needs its own breakdown or a decision first

- [ ] **10. "You usually buy this about now" suggestions**
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
      `lowStockThreshold` and usual purchase quantity (item 8) — as a
      suggestion on the item, not a silent change.

- [ ] **11. Receipt scan: auto-accept confident matches**
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
      receipts before shipping. Once item 6 exists, receipts with EANs
      (rare in Swedish receipts, but some chains print them) can match by
      barcode exactly.

- [ ] **12. Voice add**
      — `src/components/shopping/smart-add-bar.tsx` (item 1)
      **Design brief:** a mic button in the smart add line; speech goes
      into the input as text and commits through item 1's parser ("two
      liters of milk and eggs" → 2 l milk, eggs). Hidden entirely where the
      browser doesn't support speech recognition — coverage in installed
      iOS PWAs is inconsistent, so this is a bonus, never a required path.
      **Dev notes:** Web Speech API, feature-detected, locale from the
      household's language cookie. Needs a small word-to-number step
      ("två", "two") before `parsePastedList`. Disclose in the privacy page
      that some browsers process speech on the vendor's servers.

- [ ] **13. Receipts that arrive by themselves** `[!]` needs a product
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
      Either way, the output lands in the same review → apply flow (item
      11), never applied unseen.
