# Joy Gap backlog — Sep 2026

Source: "The Joy Gap," a product-positioning memo (Sep 2026) comparing Squirrel
against 9 competitors across three categories — grocery/pantry apps
(OurGroceries, AnyList, Bring!), budgeting apps (YNAB, Monarch, Copilot Money),
and family organizers (Cozi, OurHome, Tody). Its finding: every roadmap item
from the earlier feature-parity pass has shipped (see REQUIREMENTS.md's
"Roadmap" section), so the remaining gap isn't functional, it's emotional —
Squirrel covers more of the household than anyone in its category but doesn't
yet feel good to open. No competitor combines that much breadth with real
warmth; that's the opening.

This file breaks the memo's recommendations into discrete tickets a designer
can mock and a developer can build independently, in the same
wave/status format `MAINTENANCE_BACKLOG.md` uses. Same status legend:

Status legend: `[ ]` not started · `[~]` in progress · `[x]` shipped ·
`[!]` blocked / needs a decision.

## Guardrails — apply to every item below

These came directly out of the memo's "what not to do" and constrain *how*
every ticket here is built, not just which ones exist:

- **No loss-aversion streaks on money.** Nothing in Budget or Personal
  Budget (`src/app/dashboard/budget/`, `src/app/dashboard/personal-budget/`)
  gets a streak counter, a "don't break your streak" prompt, or any
  mechanic that makes a shared household budget feel like it's punishing
  someone for missing a day. Budget's joy lever is calmer copy and visual
  craft, not game mechanics — see item 4.
- **No leaderboards or member-vs-member scoring.** A household is one team
  managing one budget/pantry, not competitors. Any "who did what" surfacing
  (item 5, item 7) credits people by name, never ranks them.
- **Positive notifications must stay rare enough to trust.** The
  notification bell's entire value is that a badge means something is
  actually wrong. A "good news" kind that fires on every trivial action
  will train users to dismiss the whole bell, alerts included — see item 5's
  acceptance criteria for the actual firing rule.
- **Don't chase Tody's/OurHome's mascot-and-points depth.** Both are built
  for a single narrow job (chores) and largely for kids earning rewards.
  Squirrel's audience is adult co-managers of a household; anything modeled
  on those apps should be scaled down accordingly (see item 7's scope note).

---

## Wave 1 — now, no schema changes, single-file-ish

Independent; any order.

- [x] **1. Shopping list "cleared" state**
      — `src/app/dashboard/shopping-list/[id]/page.tsx`,
      `src/app/dashboard/shopping-list/actions.ts`
      **Problem:** checking off the last item on a shopping list currently
      just leaves an empty list — the single most satisfying moment in the
      app (household task actually finished) gets no acknowledgment.
      **Design brief:** a brief, dismissible "cleared" state that replaces
      the empty item list when every item is checked or removed — not a
      modal, not a toast that disappears before it's read. Should read as
      calm satisfaction, not a celebration overlay (no confetti/sound).
      Needs a light and dark treatment consistent with the existing
      shadcn/Base UI components already in use.
      **Dev notes:** purely a render-state change based on existing item
      data (`items.length === 0` after the household had at least one item
      this session, or all `checked`) — no new Prisma fields. Reset the
      instant a new item is added. Add the copy to both
      `src/lib/i18n/dictionaries/en.ts` and `sv.ts` (see AGENTS.md/
      REQUIREMENTS.md i18n convention — `satisfies Dictionary` will fail the
      build if `sv.ts` is missed).

- [x] **2. Inventory "stocked" empty state**
      — `src/app/dashboard/inventory/page.tsx`,
      `src/components/inventory/inventory-table.tsx`,
      `src/components/inventory/stock-badge.tsx`
      **Problem:** the inventory view is a status board that only ever has
      something to show when items are low or out — there's no positive
      state for "the pantry's in good shape," even though that's the common
      case right after a restock.
      **Design brief:** when zero items are currently low/out of stock,
      replace whatever the low-stock section currently shows (empty list?
      confirm current behavior first) with a short positive line rather
      than nothing. Should not compete visually with the item table below
      it — this is a footnote-weight state, not a hero banner.
      **Dev notes:** derive from existing `StockBadge`/low-stock filter
      logic already used for the low-stock flag — no schema change, just a
      new render branch. Confirm current empty-state behavior in
      `inventory-table.tsx` before designing against it (it may already
      render blank, which is exactly the gap).

- [x] **3. Budget copy & tone pass on "safe to spend"**
      — `src/components/budget/safe-to-spend.tsx`,
      `src/lib/safe-to-spend-calc.ts`
      **Problem:** "safe to spend" is already the one place in the app that
      chose a friendlier framing over a raw ledger number — the memo's
      recommendation is to extend that instinct, not add mechanics to it.
      **Design brief:** a plain-language one-line summary above/alongside
      the number (e.g. stating the situation in words, not just a figure),
      and a calmer color treatment — confirm current color usage in
      `safe-to-spend.tsx` (if it uses semantic red/amber/green thresholds,
      soften the low end so a tight-but-not-empty budget doesn't read as
      alarming). No new data — this is copy + visual only, reading off
      `safe-to-spend-calc.ts`'s existing output.
      **Dev notes:** `src/lib/safe-to-spend-calc.ts` already has unit tests
      (`safe-to-spend-calc.test.ts`) — a pure copy/visual change here should
      not need new calc logic. If the summary line needs a new derived
      value (e.g. days-remaining framing), add it to the calc module and
      extend its existing tests, not inline in the component.
      **Non-goal:** no streaks, no "days without overspending" counter — see
      Guardrails.

---

## Wave 2 — next, one small schema change

Depends on Wave 1's i18n/copy conventions but not on Wave 1 shipping first.

- [ ] **4. Positive notification kinds**
      — `prisma/schema.prisma` (`NotificationKind` enum, currently
      `OUT_OF_STOCK` / `MEAL_NOT_LOGGED` / `EXPIRING_SOON` — all three are
      warnings), `src/lib/notifications.ts`,
      `src/components/notifications/notification-bell.tsx`
      **Problem:** every notification kind that exists today is an alert.
      There's no way for the bell to ever carry good news, so opening it is
      always at best neutral, at worst bad.
      **Design brief:** a visually distinct treatment for a "good news" kind
      in the bell dropdown — different icon/accent from the warning kinds,
      not just the same row in a different color. Needs states for at least
      two new kinds (see dev notes) in both light and dark themes.
      **Dev notes:** add new `NotificationKind` values — start with
      `LIST_CLEARED` (fires from item 1's completion event) and
      `RESTOCKED` (fires when a previously-low/out-of-stock item crosses
      back above its low-stock threshold — the inverse of the existing
      `recordOutOfStockTransition` trigger documented in
      `prisma/schema.prisma`'s `Notification` model comment). Follow the
      existing pattern: fire at the moment the transition happens, persist
      the row, `dismissedAt` clears it from the bell. **Firing rule to
      protect trust (see Guardrails):** these should fire on meaningful
      transitions only (list going from "has items" to empty; an item
      crossing back into stock) — never on every single item check-off or
      every single restock of one unit, or the bell becomes noise.
      Migration required — run `npx prisma migrate dev` and follow this
      repo's existing migration-naming convention (check `prisma/migrations/`
      for the pattern). Add both new kinds' copy to `en.ts`/`sv.ts`.

- [ ] **5. Monthly meal-variety recap**
      — `src/app/dashboard/meal-planning/page.tsx` or a new component in
      `src/components/meal-planning/`
      **Problem:** meal planning has no sense of momentum or variety over
      time — it's a week-by-week grid with no zoom-out view.
      **Design brief:** a small, dismissible recap surfaced on the meal
      planning page — e.g. "N different meals this month" — framed as
      variety, not a score, and with zero penalty state for a quiet month
      (no "you planned nothing this month" shaming copy; a quiet month just
      shows nothing or a neutral prompt).
      **Dev notes:** derivable from existing `MealPlanEntry`/recipe data
      (distinct `recipeId` count over a trailing-30-day window) — no schema
      change, a new query in `planner-actions.ts` or a colocated helper
      (mirror the existing `*-calc.ts` / `cooked-ingredients.ts` pattern of
      keeping pure logic separate from the server action, with a unit test
      alongside it like `missing-ingredients.test.ts` does).

---

## Wave 3 — later, needs its own task breakdown before starting

- [ ] **6. Household Tasks v1** `[!]` blocked — needs a scoping pass of its
      own before implementation; sketched here at memo-level detail only.
      **Problem:** this is the actual gap in the product, not a polish
      item — Squirrel has no shared calendar or chores/tasks surface at
      all, which is exactly the ground Cozi and OurHome stand on. It's also
      the only item in this backlog that shifts Squirrel's competitive
      position rather than just its tone, because it adds coverage Squirrel
      doesn't have today.
      **Scope note (see Guardrails):** explicitly *not* OurHome's model —
      no points economy, no rewards store, no kid-vs-kid leaderboard. This
      is a shared task list for adult household co-managers, closer to "did
      the household handle the bins/dishwasher/plants this week" than to a
      chore-chart game.
      **Design brief (starting point, not final):** a new dashboard section
      alongside Inventory/Shopping List/Meal Planning/Budget; a simple
      household-scoped task list (create, assign or leave unassigned,
      complete); a weekly recap reusing item 5's "recap" visual pattern
      ("this week, the household handled: …"), crediting whoever completed
      each task by name — never a ranked list.
      **Dev notes (sketch, needs its own spec before building):** new
      Prisma model (e.g. `HouseholdTask`), household-scoped like every other
      domain table (`householdId` + `requireHousehold()` per
      REQUIREMENTS.md's multi-tenancy convention), new
      `src/app/dashboard/tasks/` route with `page.tsx` + `actions.ts`
      following the existing feature-folder pattern (compare
      `src/app/dashboard/shopping-list/`), full EN/SV dictionary coverage,
      and a decision on whether completions feed the new
      `LIST_CLEARED`-style notification pattern from item 4 or need their
      own kind. Given the size, split into its own sub-tasks (schema +
      actions, list UI, weekly recap, notification hook) the way
      `MAINTENANCE_BACKLOG.md` splits its larger items, rather than one PR.
