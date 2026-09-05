# AGENT_PROGRESS.md — Task 7: Shopping-list → budget expense link

- [x] Read AGENTS.md, REQUIREMENTS.md (Budgeting + shopping-list sections), AGENT_TASKS.md ground rules + Task 7
- [x] Re-read `src/app/dashboard/shopping-list/actions.ts` current shape (multiple-lists model, `completeShoppingListAction` fresh from Phase 1)
- [x] Re-read `src/app/dashboard/budget/actions.ts`'s `findOrCreateGroceriesCategory` (name/lookup key: case-insensitive `"Groceries"`, `type: "EXPENSE"`, scoped by householdId) + `createTransactionAction` shape (amount, categoryId, type, description, date, isRecurring, recurrenceFrequency, createdByUserId)
- [ ] Extend `completeShoppingListAction` to sum purchased-item `estimatedPrice` (only items that have one set) and create a "Groceries" `Transaction` via `findOrCreateGroceriesCategory`
- [ ] i18n keys en+sv (`shoppingList.expenseLogged` toast message, `shoppingList.expenseDescription` for the Transaction's stored description)
- [ ] Wire a toast in `shopping-list-client.tsx` showing the confirmation message when an expense was logged (flagged: this touches a file not explicitly named in "Primary/Shared files", but the task description itself calls out "a confirmation toast/message that an expense was logged" as the expected shared-files use case — treating this as in-scope, minimal, and necessary to surface the feature, since `completeShoppingListAction` is a plain click action with no other UI surface)
- [ ] REQUIREMENTS.md subsection (nested under "Budgeting", plus remove the item from "Not yet built")
- [ ] tsc/eslint/build pass
- [ ] final commit

## Notes / decisions
- `estimatedPrice` on `ShoppingListItem` has no UI to set it yet anywhere in the app (grep confirms it's only read, never written from a form) — summing it is still correct per the task spec ("only items that actually have one set"), it just means the total will most often be 0 today. Not in scope to add a price-entry UI.
- Treating `estimatedPrice` as already the total for that line item (not per-unit) — consistent with how `togglePurchasedAction` already uses `item.estimatedPrice` directly (unmultiplied by quantity) when writing `PriceHistory`.
- Only create the Transaction when the summed total is > 0 — a $0 expense transaction serves no purpose.
- Not wrapping the status update + transaction create in one `$transaction`, since `findOrCreateGroceriesCategory` takes a plain `prisma` client (not a `tx`) and duplicating its lookup inside a transaction would violate "use Task 2's helper, don't duplicate it". Matches the existing file's style of sequential (non-transactional) find-or-create calls elsewhere (e.g. `addAdHocItemAction`).
