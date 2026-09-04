# Budgeting UI — Progress

Branch: `feature/budgeting`

## Checklist

- [ ] Read AGENTS.md, REQUIREMENTS.md, AGENT_TASKS.md, and surveyed existing
      conventions (shopping-list feature, household feature, ui primitives)
- [ ] `src/app/dashboard/budget/actions.ts` — category CRUD actions
- [ ] `src/app/dashboard/budget/actions.ts` — transaction CRUD actions
- [ ] `findOrCreateGroceriesCategory(householdId)` helper exported
- [ ] Category management UI (`src/components/budget/category-manager.tsx`)
- [ ] Transaction list UI with add/edit/delete
      (`src/components/budget/transaction-list.tsx`,
      `src/components/budget/transaction-dialog.tsx`)
- [ ] Recurring transaction support (isRecurring + recurrenceFrequency) in
      the transaction form + displayed in the list
- [ ] Period summary (this month income vs expense by category)
      (`src/components/budget/period-summary.tsx`)
- [ ] `src/app/dashboard/budget/page.tsx` wired up, replacing placeholder
- [ ] i18n: `budget` namespace added to both `en.ts` and `sv.ts`
- [ ] REQUIREMENTS.md: new Budgeting subsection + "Not yet built" line
      removed, Groceries helper documented
- [ ] `npx tsc --noEmit -p tsconfig.json` — zero errors
- [ ] `npx eslint src` — zero errors/warnings
- [ ] `npm run build` — succeeds
- [ ] Final commit with everything checked off

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
