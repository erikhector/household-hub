# Planned bills (BUDGET-8) — design

Status: approved in conversation 2026-10-15, awaiting written-spec review.
Backlog item: **BUDGET-8. One-off shared cost / planned shared expense
mechanism**.

## Intent

**What the owner said:** the use case is a *known, non-recurring bill with a
due date* (e.g. a car-repair or dentist invoice due 20 Nov, split 50/50). It
should count as due in the household budget and in each participant's
personal budget until it's paid. Paying it means logging a real
transaction from it. If nobody pays it by the due date, it carries forward
as overdue rather than disappearing.

**Assumptions (not stated, chosen during design):**

- Expenses only — no planned one-off income or savings.
- A split is optional; an unsplit planned bill still counts in the
  household's safe to spend.
- One payment closes the bill, at whatever amount was actually logged.
- Planned one-off *purchases with no fixed date* ("a vacuum sometime this
  spring") are out of scope.

**Success:** a member can add a planned bill with a due date and shares.
Until it's logged, it lowers household safe to spend (full amount) and each
participant's personal safe to spend (their share). It is logged through
the normal transaction dialog, pre-filled, and then counts only through
that transaction. Past months still show what was due at the time.

## Approach

New `PlannedExpense` + `PlannedExpenseSplit` tables, linked from a new
`Transaction.plannedExpenseId`. This mirrors `RecurringTemplate` /
`RecurringTemplateSplit`. Rejected:

- `Transaction.status: PLANNED | POSTED`. Every existing sum (period
  summary, category budgets, balances, settle-up, personal position,
  exports) would need a status filter, and missing one silently counts
  unpaid money as spent.
- A `ONCE` frequency on `RecurringTemplate`. Templates are built around
  per-period keys that reset each period, the opposite of "carry forward
  until paid".

## 1. Data model

One migration, `planned_expenses`.

```prisma
model PlannedExpense {
  id              String   @id @default(cuid())
  householdId     String
  categoryId      String
  name            String
  amount          Float
  // Date only; time is ignored, compared against month bounds.
  dueDate         DateTime
  createdByUserId String?
  createdAt       DateTime @default(now())

  household   Household             @relation(fields: [householdId], references: [id], onDelete: Cascade)
  category    BudgetCategory        @relation(fields: [categoryId], references: [id])
  splits      PlannedExpenseSplit[]
  transaction Transaction?

  @@index([householdId, dueDate])
  @@index([categoryId])
}

model PlannedExpenseSplit {
  id                String   @id @default(cuid())
  plannedExpenseId  String
  householdMemberId String
  amountOwed        Float
  createdAt         DateTime @default(now())

  plannedExpense  PlannedExpense  @relation(fields: [plannedExpenseId], references: [id], onDelete: Cascade)
  householdMember HouseholdMember @relation(fields: [householdMemberId], references: [id], onDelete: Cascade)

  @@unique([plannedExpenseId, householdMemberId])
  @@index([plannedExpenseId])
  @@index([householdMemberId])
}

// on Transaction
plannedExpenseId String?         @unique
plannedExpense   PlannedExpense? @relation(fields: [plannedExpenseId], references: [id], onDelete: SetNull)
```

Rules:

- **Paid is derived**, never stored: a bill is paid when a transaction links
  to it. `@unique` on `Transaction.plannedExpenseId` means a bill can be
  logged at most once, enforced by the database.
- Deleting a planned bill sets the transaction's link to null; the
  transaction survives. Deleting the transaction makes the bill unpaid
  again.
- Splits are absolute amounts summing to `amount` (±0.01), the same rule
  `RecurringTemplateSplit` follows. Empty means unsplit.
- No `type` column: always an expense.
- The existing `Transaction.splits` / `amountPaid` still describe who
  actually paid when it's logged. The planned split is only the expectation.

## 2. Calculations

Pure module `src/lib/planned-expense-calc.ts` (no Prisma import), tested in
`planned-expense-calc.test.ts`.

`getPlannedExpenseStatus({ dueDate, paidAt }, monthStart, monthEnd)` where
`paidAt` is the linked transaction's date or null:

| status     | condition                                                       |
|------------|-----------------------------------------------------------------|
| `paid`     | `paidAt !== null && paidAt < monthEnd`                          |
| `upcoming` | not paid, `dueDate >= monthEnd`                                 |
| `due`      | not paid, `monthStart <= dueDate < monthEnd`                    |
| `overdue`  | not paid, `dueDate < monthStart`                                |

"Not paid" means `paidAt === null || paidAt >= monthEnd`, so a past month
shows the bill as it stood at that month's end (due in Oct, paid 3 Nov is
`due` in October).

**Household safe to spend.** `computeSafeToSpend` gains an optional
`plannedExpenses: { id, name, categoryId, amount, status }[]` input
(default `[]`). Every `due`/`overdue` one is added to `breakdown`'s due
payments and appears in the due rows under its own name. They are **not**
merged into `templates`: that input also builds `templateCategoryIds`,
which turns off the older "this repeats" estimate for a category, and a
one-off bill must not do that. A `paid` bill already counts through its
transaction in `expenseSoFar`. With no planned bills the result is
unchanged.

**Category budgets / period summary.** Unchanged. An unpaid planned bill is
never "spent" in its category.

**Personal budget** (`src/lib/personal-budget-position.ts`): one query over
`PlannedExpenseSplit` for the user's member ids, with
`plannedExpense.dueDate < monthEnd`, including the bill, its category,
all of its splits and its transaction's date. Every `due`/`overdue` bill
adds a shared row at the user's `amountOwed`, with `source: "shared"` and
the household name, folded into the same "not yet logged" reduction as
shared templates.

**Household page query** (`src/app/dashboard/budget/page.tsx`): planned
bills with `dueDate < monthEnd` and not paid before `monthStart`, plus those
due later (upcoming), scoped by `householdId`, with splits and the linked
transaction's date. Bills paid before `monthStart` are left out, so the
query and the list don't grow with history.

## 3. UI

Follows DESIGN.md, including the hard mobile rules M1–M10.

- **`PlannedExpensesPanel`** (`src/components/budget/planned-expenses-panel.tsx`),
  in the Budget page's Manage tab directly under `RecurringTemplatesPanel`.
  Groups: Overdue, Due this month, Upcoming, Paid (paid in the viewed month
  only). Overdue is tinted text plus an icon. Each row: name, amount, due
  date, category, a share summary. Row actions: Log payment, Edit, Delete
  (confirmed); a paid row has only Edit. Targets ≥ 44 × 44 px on phones.
  Empty state explains what a planned bill is, with the add button.
- **`PlannedExpenseDialog`**: name, amount (`inputMode="decimal"`),
  category (Base UI `Select` with a label-mapping `SelectValue`), due date
  (native date input, default today), and, when the household has more
  than one member, an opt-in share-only split section (pre-filled even
  split via `evenSplitAmounts`). That is the same share-only UI
  `RecurringTemplateDialog` already has, not `SplitEditor`, whose "Paid"
  column makes no sense before anything is paid. One primary action: Save.
  Inline errors next to fields; pending state on submit.
- **Log payment** opens the existing `TransactionDialog` pre-filled through
  the existing `SharedExpensePrefill` path, extended with an optional
  `plannedExpenseId`: name as description, planned amount, category,
  planned shares, current member as payer. Everything is editable. The
  transaction actions accept the hidden `plannedExpenseId`.
- **`DueRecurringWidget`** also lists due and overdue planned bills, labelled
  as such, with the same Log payment action.
- **Safe to spend** breakdown lists them among due payments by name.
- **Personal Budget**: the user's share shows as a "Shared" due row with the
  household name, linking to the household budget (no log controls there),
  as for shared templates.
- All strings in `en.ts` and `sv.ts` (e.g. "Planned bills" / "Planerade
  räkningar", "Overdue" / "Försenad", "Upcoming" / "Kommande").

## 4. Server actions

In a new `src/app/dashboard/budget/planned-expense-actions.ts` with its own
`planned-expense-actions.test.ts` (`actions.ts` is already 1 000+ lines;
MAINT-3 is splitting the same kind of file), each with `requireHousehold()`.
The transaction-action change below stays in `actions.ts`:

- `createPlannedExpenseAction(prevState, formData)` /
  `updatePlannedExpenseAction(prevState, formData)`: Zod-validated name
  (non-empty), amount (> 0), category id (must be an `EXPENSE` category of
  the household), due date (valid date). Splits parsed and checked with the
  existing `parseSplitFormData` rules (sum equals amount, members belong to
  the household). Update replaces splits wholesale in one `$transaction`.
  Updating a paid bill is allowed (fixing a typo) and doesn't touch its
  transaction.
- `deletePlannedExpenseAction(id)`: click action, scoped by household.
- `createTransactionAction` / `updateTransactionAction`: accept an optional
  `plannedExpenseId`. When present, it must belong to the household and not
  already be linked to another transaction; otherwise a validation error
  (the `@unique` constraint is the backstop for races, mapped to the same
  error).

All revalidate the budget and personal budget paths.

## 5. Tests

Unit (Vitest, mocked Prisma, following existing `actions.test.ts`):

- `planned-expense-calc.test.ts`: every status; due on the 1st and on the
  last day; paid exactly at `monthEnd`; due Oct / paid 3 Nov viewed in Oct
  and Nov.
- `safe-to-spend-calc.test.ts`: due/overdue add to due payments; upcoming
  and paid don't; a planned bill doesn't suppress the "this repeats"
  estimate for its category; no planned bills gives an identical result.
- Action tests: `requireHousehold()` on each; foreign category or member
  rejected; shares not summing rejected; non-expense category rejected;
  logging a paid or foreign bill rejected; successful log links the
  transaction and creates its splits.
- `personal-budget-position` test: share appears only for split members and
  only while due/overdue in the viewed month.

E2E (`e2e/planned-expenses.spec.ts`, desktop and mobile): add a planned bill
due this month with a split, reload, see it under "Due this month" and in
the due strip and safe to spend lowered by its amount; log the payment from
the pre-filled dialog; see it under "Paid" and the transaction in the list;
check the shared row on the second member's Personal Budget. `unique()`
names, worker-seeded household, cleanup scoped to `E2E_HOUSEHOLD`. No new
page, so `e2e/routes.ts` is unchanged.

## 6. Docs and release

- REQUIREMENTS.md: new "Planned bills" subsection in the budget section;
  a line in "Safe to spend" and in the household/personal budget link.
- Delete BUDGET-8 from BACKLOG.md.
- PR title `feat: planned bills for one-off shared costs (BUDGET-8)`,
  release note in English and Swedish.
- Touches AUTOPILOT.md human-only areas (`*budget*`, `*split*`,
  `*transaction*`): flagged for human review; the owner merges.

## Out of scope

Planned income or savings; planned purchases without a date; several
partial payments against one planned bill; reminders or push notifications
for due bills; planned bills in the personal-only budget (not shared with a
household).
