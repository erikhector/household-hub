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

Parallel-safe except where noted.

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

### Shopping list & inventory automation

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
      v1 — `PriceHistory.store` is populated when a household names one on
      a receipt scan/register (GAP-6), but it's
      optional and still null on most rows, nowhere near reliable enough
      yet to key a learned order off of.

---

## Phase 3 — larger items, own PR each

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

- [ ] **GAP-13. A household currency setting** —
      `prisma/schema.prisma` (`Household`), `src/app/dashboard/household/
      page.tsx`, every `Intl.NumberFormat` call site in
      `src/components/budget/`, `src/components/shopping/`, and
      `src/lib/csv.ts`'s money columns. REQUIREMENTS.md's Budgeting section
      already notes "no household-level currency setting, so a symbol would
      be a guess" — Splitwise and YNAB both show a real currency symbol.
      Add an optional `currencyCode String?` (ISO 4217, e.g. `"SEK"`,
      `"USD"`) to `Household` (Phase 2 migration), a select on the Household
      page defaulting to unset (today's symbol-free behavior, so existing
      households see no change until they opt in), and a small shared
      formatter (`src/lib/currency.ts`) that passes
      `{ style: "currency", currency }` to `Intl.NumberFormat` when set,
      falling back to the current plain-decimal formatting otherwise. CSV
      exports keep the existing plain-`.`-decimal numbers regardless (per
      "Data export (CSV)"'s locale-collision reasoning) — this only touches
      on-screen formatting.

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
      AUTO-8's auto-add-to-list and (once shipped) AUTO-10's repurchase
      suggestions all fire on a schedule that doesn't know the household is
      on vacation. Cozi-style family organizers don't solve this either, so
      there's no single pattern to copy. Options range from a single
      `Household.pausedUntil` date that every sync function
      (`getActiveNotifications`, the low-stock crossing helpers) checks and
      no-ops against, to doing nothing until AUTO-8/AUTO-10 actually ship
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

- [ ] **GAP-29. Recipe dietary tags and filtering** —
      `prisma/schema.prisma` (`Recipe`), `src/components/meal-planning/
      recipe-manager.tsx`. Mealime and Plan to Eat let a household mark a
      recipe vegetarian/gluten-free/dairy-free/etc. and filter the recipe
      list by it; `Recipe` has no such field today and `RecipeManager` only
      supports a free-text name search. Add a small fixed `tags String[]`
      (a closed set, labelled via a dictionary namespace the same way
      AUTO-2's `inventory.autoCategories` keys are, not freeform text) set
      from a multi-select in `RecipeFormDialog`, and a filter row above the
      recipe list mirroring the inventory page's category/location filter
      pattern.

- [ ] **GAP-30. Move a meal-plan entry to a different day/slot** —
      `src/app/dashboard/meal-planning/planner-actions.ts`,
      `src/components/meal-planning/week-planner.tsx`. Mealime and Plan to
      Eat let you drag a planned meal to another day. REQUIREMENTS.md's
      "Editing a meal entry" section states plainly that "date and meal
      type aren't editable, so moving a meal still means deleting it and
      adding it again" — `updateMealEntryAction` only ever patches
      `recipeId`/`freeformName`/`portions`, never `date`/`mealType`.
      Extend it to accept an optional new date + `MealType`, reusing
      `addMealEntryAction`'s existing "slots can stack, no uniqueness
      constraint" behavior, and add a "Move" affordance (or drag-and-drop)
      to `WeekPlanner` alongside the existing edit pencil.

- [ ] **GAP-31. Recipe import beyond JSON-LD-only pages** —
      `src/lib/recipe-import.ts`. Plan to Eat's browser clipper imports
      from almost any recipe blog; Squirrel's importer only extracts
      `<script type="application/ld+json">` `Recipe` blocks and returns
      `importErrorNoRecipeFound` for anything Microdata-only or
      unstructured (see the file's own header comment on why only
      JSON-LD is handled today). A best-effort HTML fallback (heading +
      list-heuristic extraction, clearly labelled "review before saving"
      since it'll be less reliable than JSON-LD) would cover the sites
      that fall through today, without promising a full clipper.

- [ ] **GAP-32. Shopping list from more than "this visible week"** —
      `src/app/dashboard/meal-planning/cooking-actions.ts`
      (`previewMissingIngredientsAction`), `.../missing-ingredients.ts`.
      Plan to Eat and Mealime can build one shopping list from any date
      range (e.g. "the next two weeks" before a big trip). Squirrel's
      missing-ingredients bridge is hard-scoped to a single
      `MealPlan.weekStartDate` — `previewMissingIngredientsAction` looks up
      exactly one week's plan. Parameterizing it by a `[from, to)` date
      range instead (spanning `MealPlanEntry.date` across however many
      `MealPlan` rows fall in it) would let `MissingIngredientsDialog` offer
      "This week" (today's default) or a custom range.

- [ ] **GAP-33. Total value of what's currently on hand** —
      new `src/lib/inventory/stock-value.ts` (pure, unit-tested, alongside
      `expired-waste.ts`), surfaced on the Inventory page or Cost analyzer.
      Grocy's headline stat is the pantry's total monetary value. Squirrel
      already computes what expired *unused* (`computeExpiredWaste`,
      GAP-17) but nothing sums `InventoryItem.lastKnownPrice` across
      current stock the same way — same "one `lastKnownPrice` per item,
      never × quantity for a per-line price" caveat GAP-17's write-up
      already spells out for exactly this reason.

- [ ] **GAP-34. Whole-basket "cheapest store" comparison** —
      `src/lib/cheapest-store-calc.ts`, `src/components/budget/
      cost-analyzer.tsx`. Listonic/Out of Milk compare a *list's* total
      cost across stores, not just one item at a time. GAP-6 (shipped)
      already built `computeCheapestStoreComparisons`, but it's
      strictly per-item — "which store had item X cheapest last time,"
      never "which store would this whole pending list cost least at."
      Extending the same calculator to sum each pending shopping-list
      item's cheapest-known price per store (skipping items with no
      cross-store history, the same ≥2-distinct-stores bar GAP-6 already
      uses) would need only a small addition, not a new data source.

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

- [ ] **GAP-38. Chore rotation among household members** `[!]` —
      needs a product decision. `HouseholdTask` already grew a
      `recurrenceIntervalDays` (an undocumented addition — REQUIREMENTS.md's
      "Household tasks" section still says v1 has "no due dates, no
      recurrence" and should be corrected to match `prisma/schema.prisma`
      and `src/app/dashboard/tasks/actions.ts`, which already have it), but
      there's no rotation: Grocy's Chores module and OurHome auto-assign a
      recurring chore to the next person in line each time it's completed.
      Squirrel's own Guardrails explicitly rule out "member-vs-member
      leaderboards," and an auto-rotating assignee is adjacent to that
      concern without being the same thing — worth deciding whether
      round-robin assignment (no scoring, just whose turn it is) crosses
      that line before building `nextAssigneeInRotation`-style logic onto
      `toggleTaskCompletedAction`.

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
