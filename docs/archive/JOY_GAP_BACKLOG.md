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

- [x] **4. Positive notification kinds**
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

- [x] **5. Monthly meal-variety recap**
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

- [x] **6. Household Tasks v1** — scoped below into 6a-6d, same
      sub-task/status-tracking convention `MAINTENANCE_BACKLOG.md` uses for
      its larger items. **Problem:** this is the actual gap in the
      product, not a polish item — Squirrel has no shared calendar or
      chores/tasks surface at all, which is exactly the ground Cozi and
      OurHome stand on. It's also the only item in this backlog that shifts
      Squirrel's competitive position rather than just its tone, because it
      adds coverage Squirrel doesn't have today.
      **Scope note (see Guardrails):** explicitly *not* OurHome's model —
      no points economy, no rewards store, no kid-vs-kid leaderboard, no
      due dates or recurrence in v1 (a chore-chart-style schedule is a
      bigger, separate decision — see 6c's non-goals). This is a shared
      task list for adult household co-managers, closer to "did the
      household handle the bins/dishwasher/plants this week" than to a
      chore-chart game.
      **Sequencing:** 6a is the foundation every other sub-task needs
      (schema + actions) and should land first; 6b (list UI) and 6c (weekly
      recap) can then proceed in parallel — 6c only needs 6a's data shape,
      not 6b's UI. 6d (notification hook) is optional polish, decoupled
      from the rest; see its own note on why it's last and not blocking.

  - [x] **6a. Schema + actions** — the foundation; everything else in this
        item depends on it landing first.
        **Schema (`prisma/schema.prisma`):** a `HouseholdTask` model,
        household-scoped like every other domain table (`householdId` +
        `requireHousehold()` per REQUIREMENTS.md's "Multi-tenancy model"
        section):
        ```
        model HouseholdTask {
          id                  String    @id @default(cuid())
          householdId         String
          title               String
          assignedToMemberId  String?
          completedAt         DateTime?
          completedByMemberId String?
          createdAt           DateTime  @default(now())

          household         Household        @relation(fields: [householdId], references: [id], onDelete: Cascade)
          assignedToMember  HouseholdMember? @relation("TaskAssignedTo", fields: [assignedToMemberId], references: [id], onDelete: SetNull)
          completedByMember HouseholdMember? @relation("TaskCompletedBy", fields: [completedByMemberId], references: [id], onDelete: SetNull)

          @@index([householdId])
          @@index([assignedToMemberId])
        }
        ```
        `assignedToMemberId`/`completedByMemberId` are two distinct,
        independently-nullable fields — a task can be completed by someone
        other than whoever it was assigned to, and an unassigned task can
        still be completed. Both use `onDelete: SetNull` (never `Cascade`)
        — mirrors `Transaction.paidByMemberId`'s exact precedent
        (`prisma/schema.prisma` — search `TransactionPaidBy`): removing a
        household member unassigns/un-attributes their tasks rather than
        deleting task history. `completedAt` nullable-timestamp-as-status
        (not a separate boolean, not an enum) mirrors
        `MealPlanEntry.consumedAt`. No due date, no recurrence field — v1
        non-goal, see 6's scope note. Add the `tasks HouseholdTask[]`
        back-relation on `Household`. Migration required — run
        `npx prisma migrate dev` (needs a reachable Postgres; this repo's
        `docker-compose.yml` provides one, or point `DATABASE_URL` at any
        local Postgres 16+ — a local `postgresql-16` server package works
        fine if Docker isn't available) and follow the existing
        migration-naming convention (check `prisma/migrations/` for the
        pattern).
        **Actions (`src/app/dashboard/tasks/actions.ts`, new file):**
        follow the shopping-list actions module's conventions
        (`src/app/dashboard/shopping-list/actions.ts`) — every action
        starts with `requireHousehold()`, scopes every query/mutation to
        `householdId`, wraps Prisma errors in `toFriendlyError`, calls
        `revalidatePath("/dashboard/tasks")` on success.
        - `createTaskAction(prevState, formData)` — `title` (required,
          trimmed, reasonable max length — mirror
          `ShoppingListItem.name`'s 120-char cap) and an optional
          `assignedToMemberId` (validate it actually belongs to this
          household before writing it, same IDOR guard every other
          member-id-accepting action in this codebase already has —
          compare `transaction-dialog.tsx`'s member select flow).
        - `toggleTaskCompletedAction(taskId)` — flips `completedAt`
          between `null` and `new Date()`; sets/clears
          `completedByMemberId` to the *caller's own* household-member id
          (derive it the same way `src/app/dashboard/budget/page.tsx`
          does: `householdMembers.find(m => m.userId === userId)?.id` —
          never trust a client-supplied completer id) each time it's
          checked, so re-opening and re-completing by a different member
          re-attributes correctly. Mirrors `togglePurchasedAction`'s
          shape.
        - `deleteTaskAction(taskId)` — household-scoped delete, mirrors
          `deleteShoppingListItemAction`.
        - Skip a dedicated "edit"/re-assign action for v1 — reuse
          create+delete, or fold re-assignment into a small inline control
          in 6b if it turns out to be needed; don't build it speculatively
          here.
        **Tests:** mocked-Prisma unit tests for all three actions,
        matching `src/app/dashboard/shopping-list/actions.test.ts`'s
        convention — cover the household-scoping/IDOR guard on
        `assignedToMemberId` and on the taskId itself for each action.

  - [x] **6b. List UI** — depends on 6a.
        **Route:** `src/app/dashboard/tasks/page.tsx` (Server Component:
        `requireHousehold()`, fetch this household's `HouseholdTask` rows
        plus its `HouseholdMember` list for the assignee picker — mirror
        `src/app/dashboard/inventory/page.tsx`'s `members` query/mapping)
        + `src/components/tasks/tasks-client.tsx` (Client Component,
        mirrors `ShoppingListClient`'s shape: an add-task form, a flat
        list — no multiple lists like shopping lists have, this is one
        shared household list — split into an open section and a
        completed section the way shopping-list splits pending/purchased).
        Each row: checkbox to toggle complete, title, an assignee
        badge/select (nullable — an unassigned task shows a neutral
        "Unassigned" state, never a blank/broken-looking gap), and credits
        the completer by name once done (never a count or ranking per
        person — see 6's Guardrails scope note).
        **Nav wiring:** add a `"tasks"` entry to `NavKey` and `navItems` in
        `src/components/dashboard/nav-items.ts` (a `ListChecks` or
        `CheckSquare` lucide icon fits the existing icon language) — leave
        it out of `primaryMobileHrefs` initially (mobile bottom bar has
        room for ~4; it lives behind "More" like Meal Planning/Personal
        Budget/Household/Profile already do) unless usage after shipping
        shows it deserves primary placement. Add `dict.nav.tasks` plus a
        full `dict.tasks` dictionary block (title/subtitle/empty
        states/add-form labels/assignee picker copy) to both `en.ts` and
        `sv.ts` — `satisfies Dictionary` will fail the build if `sv.ts` is
        missed (see AGENTS.md/REQUIREMENTS.md's i18n convention).
        **Non-goal:** no per-task due date/recurrence UI — see item 6's
        scope note.

  - [x] **6c. Weekly recap** — depends on 6a's data shape, not on 6b
        landing first (can build in parallel with 6b).
        Reuses item 5's recap pattern exactly: a pure, dependency-free calc
        module — `src/app/dashboard/tasks/weekly-recap-calc.ts`, mirroring
        `src/app/dashboard/meal-planning/meal-variety-calc.ts`'s shape —
        that takes this household's `HouseholdTask` rows (`completedAt`,
        `completedByMemberId`) and `now`, and returns the current week's
        completed tasks grouped by completer (resolve display names in the
        page/component layer, same separation the calc-module pattern
        elsewhere in this repo already uses — the calc itself stays
        Prisma-free and takes plain data). Reuse
        `getWeekStart`/`toDateKey` from
        `src/app/dashboard/meal-planning/date-utils.ts` rather than
        reimplementing week-boundary math — `src/lib/notifications.ts`
        already imports that module cross-feature, so it's an established
        shared utility, not meal-planning-private. Add a unit test file
        alongside it mirroring `meal-variety-calc.test.ts`.
        **Rendering:** a `TasksWeeklyRecap` component styled like
        `MealVarietyRecap` (`src/components/meal-planning/
        meal-variety-recap.tsx`) — small, dismissible, footnote-weight,
        rendered only when the week has at least one completed task (a
        quiet week shows nothing, exact same non-goal as item 5 — "no 'the
        household did nothing this week' shaming copy"). Copy reads as
        variety/coverage ("this week, the household handled: bins,
        dishwasher, plants"), crediting each completer by name in the
        list — explicitly never sorted by per-person count and never
        labeled with a count per person, which would read as a leaderboard
        (see Guardrails).

  - [ ] **6d. Notification hook** `[!]` needs a product decision — optional
        polish, does not block 6a-6c shipping. Two options, no clear
        winner without user feedback on 6a-6c first:
        - **Recommended default: no notification for v1.** 6c's weekly
          recap already gives completions a positive surface: a dedicated
          bell alert on top of that risks exactly the
          "positive-notifications-become-noise" failure the Guardrails
          section warns about (item 4's firing-rule rationale), for a
          domain that's brand new and unproven. Ship 6a-6c, revisit once
          there's real usage to judge against.
        - **Alternative:** a `TASKS_CLEARED` kind, structurally identical
          to `LIST_CLEARED` (`src/lib/notifications.ts`'s
          `recordListClearedTransition` — the household's open-task count
          crossing from >0 to 0) — same dedup/push/bell-icon pattern
          already built in item 4, so it's cheap to add later without
          touching 6a-6c's schema or actions. Its own migration, isolated
          from 6a's.
        Whichever way this goes, it's a small, self-contained follow-up —
        not a reason to hold up 6a-6c.
