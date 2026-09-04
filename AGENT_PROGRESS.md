# Budgeting UI — Progress

Branch: `feature/budgeting`

## Checklist

- [x] Read AGENTS.md, REQUIREMENTS.md, AGENT_TASKS.md, and surveyed existing
      conventions (shopping-list feature, household feature, ui primitives)
- [x] `src/app/dashboard/budget/actions.ts` — category CRUD actions
- [x] `src/app/dashboard/budget/actions.ts` — transaction CRUD actions
- [x] `findOrCreateGroceriesCategory(householdId)` helper exported
- [x] Category management UI (`src/components/budget/category-manager.tsx`)
- [x] Transaction list UI with add/edit/delete
      (`src/components/budget/transaction-list.tsx`,
      `src/components/budget/transaction-dialog.tsx`)
- [x] Recurring transaction support (isRecurring + recurrenceFrequency) in
      the transaction form + displayed in the list
- [x] Period summary (this month income vs expense by category)
      (`src/components/budget/period-summary.tsx`)
- [x] `src/app/dashboard/budget/page.tsx` wired up, replacing placeholder
- [x] i18n: `budget` namespace added to both `en.ts` and `sv.ts`
- [x] REQUIREMENTS.md: new Budgeting subsection + "Not yet built" line
      removed, Groceries helper documented
- [x] `npx tsc --noEmit -p tsconfig.json` — zero errors
- [x] `npx eslint src` — zero errors/warnings
- [x] `npm run build` — succeeds
- [x] Final commit with everything checked off

## Decisions / notes

- No Prisma migration needed — `BudgetCategory`/`Transaction` models already
  exist in `prisma/schema.prisma`.
- Groceries category lookup key: name `"Groceries"`, type `EXPENSE`,
  case-insensitive match within household (mirrors
  `findOrCreateInventoryItem`). Exact helper:
  `findOrCreateGroceriesCategory(householdId: string)` in
  `src/app/dashboard/budget/actions.ts`.
- `Transaction.type` is derived server-side from the selected category's
  `type` (not user-selected independently) to keep it consistent with
  `BudgetCategory.type` — avoids the two fields disagreeing.
- Category deletion is blocked (returns an error) if any transactions still
  reference it, since `Transaction.categoryId` is required and has no
  `onDelete` cascade/set-null in the schema (would otherwise violate the FK
  constraint at the DB level).
- No DB available needed for this task's Definition of Done since no schema
  change; `npm run build`/`tsc`/`eslint` don't require a live Postgres
  connection.
- Ran a manual smoke test against the shared dev Postgres (`docker compose
  up -d` was already running): `next dev` refused to start a second
  instance because Next 16 detects the sibling worktree's dev server as the
  "same project" and locks — worked around it with a production
  `next build && next start -p 54321` (with `AUTH_TRUST_HOST=true` since
  Auth.js otherwise rejects the non-default port/host) instead. Confirmed
  in the browser: `/dashboard/budget` renders the title/subtitle, a
  disabled "Add transaction" button + "Add a category below…" warning with
  zero categories, the This month summary cards (all 0.00), empty
  income/expense-by-category cards, the empty-transactions message, and the
  Categories card with a working "Add category" dialog (Name field + Type
  select defaulting to Expense). Stopped mid-flow because the shared
  browser pane appears to be used concurrently by another sibling agent
  (the tab unexpectedly navigated to a `/dashboard/profile` page with
  email/password fields I never built, mid-session) — rather than risk
  further cross-talk, finished verification via `tsc`/`eslint`/`build` (all
  green) and a careful re-read of every new file instead of continuing
  interactive testing.
- Copied `.env` from the main repo root into this worktree for the smoke
  test only (worktrees don't inherit gitignored files) — it's gitignored
  here too, confirmed via `git check-ignore`, so nothing got committed.
