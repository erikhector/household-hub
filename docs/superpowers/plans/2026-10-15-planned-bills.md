# Planned Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household add a one-off bill with a due date and member shares. Until it's logged, it counts as due in the household's and each participant's safe to spend, carrying forward as overdue.

**Architecture:** New `PlannedExpense` + `PlannedExpenseSplit` tables and a nullable unique `Transaction.plannedExpenseId`. "Paid" is derived from the linked transaction's date by a pure calculator. Household safe to spend gets a separate `plannedExpenses` input, and the personal budget adds the user's share as shared due rows. UI: a panel in the Manage tab, a dialog, rows in the due strip, and Log payment through the existing `TransactionDialog` prefill.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 / PostgreSQL, Zod, Base UI + shadcn, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-planned-bills-design.md`

## Global Constraints

- Every Server Action calls `requireHousehold()`; never accept a household id from the client; every query scoped by `householdId` (directly or through the parent).
- Form actions: `(prevState: ActionState, formData: FormData) => Promise<ActionState>` with `useActionState`; click actions (delete) via `useTransition`.
- All user-facing text in both `src/lib/i18n/dictionaries/en.ts` and `sv.ts`; no hardcoded JSX strings; dictionary values are plain strings.
- Base UI: compose with `render`, never `asChild`; `SelectValue` gets a children function mapping ids to labels.
- DESIGN.md Mobile rules M1–M10 are hard: ≥ 44 × 44 px targets with 8 px gaps on phones, `inputMode="decimal"` on amounts, one primary action per view, status as tinted text + icon, no overflow at 412 px in en and sv.
- Split sums must equal the amount within ±0.01 (`SPLIT_SUM_TOLERANCE`).
- Tests never touch a real DB; mock `@/lib/prisma`, `@/lib/session`, `next/cache` like `src/app/dashboard/budget/actions.test.ts`.
- No model identifiers in commits. Commit trailer per session instructions.
- Work on branch `feat/planned-bills` (already created off `next`).

## Review Focus

1. **Bill due in a past month, paid in a later one, viewed in the earlier month** → shows as `due` there and counts in that month's safe to spend (Task 2 test `due Oct / paid 3 Nov viewed in October`).
2. **Two members press Log payment at the same time** → one transaction is linked, the other gets "This planned bill is already paid", not a 500 (Task 5 test `maps a unique-constraint race to the already-paid error`).
3. **A planned bill in a category that also has old "this repeats" transactions** → the older estimate for that category is still shown (Task 3 test `does not suppress the repeat estimate`).
4. **Transaction logged from a planned bill is deleted** → the bill is due again (Task 1's `onDelete: SetNull`, asserted at the end of the Task 6 e2e test: deleting the transaction puts the bill back under "Due this month").
5. **Due date on the 1st or the last day of the month in a non-UTC timezone** → it lands in the month the user picked. Dates are stored as UTC noon of the chosen day (Task 4 `parses dueDate as UTC noon`), so month bounds can't shift them.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (Transaction ~1046, add models after `RecurringTemplateAck` ~1240, back-relations on `Household`, `BudgetCategory`, `HouseholdMember`)
- Create: `prisma/migrations/<timestamp>_planned_expenses/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `PlannedExpense { id, householdId, categoryId, name, amount: Float, dueDate: DateTime, createdByUserId?, createdAt, splits, transaction? }`, `PlannedExpenseSplit { id, plannedExpenseId, householdMemberId, amountOwed: Float, createdAt }`, `Transaction.plannedExpenseId String? @unique` with relation `plannedExpense` (`onDelete: SetNull`). Delegates `prisma.plannedExpense`, `prisma.plannedExpenseSplit`.

- [ ] **Step 1:** Add the models and the `Transaction` field exactly as in spec §1, with doc comments in the style of `RecurringTemplate`/`RecurringTemplateSplit` (why paid is derived; why `@unique`; why `SetNull`). Back-relations: `Household.plannedExpenses`, `BudgetCategory.plannedExpenses`, `HouseholdMember.plannedExpenseSplits`.
- [ ] **Step 2:** Run `npx prisma migrate dev --name planned_expenses`. Expected: a new migration folder, "Your database is now in sync", client regenerated.
- [ ] **Step 3:** Run `npm run typecheck`. Expected: no errors.
- [ ] **Step 4:** Commit `feat(budget): add PlannedExpense schema (BUDGET-8)` with schema + migration.

### Task 2: Planned bill status calculator

**Files:**
- Create: `src/lib/planned-expense-calc.ts`
- Test: `src/lib/planned-expense-calc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PlannedExpenseStatus = "paid" | "due" | "overdue" | "upcoming";
  export function getPlannedExpenseStatus(
    bill: { dueDate: Date; paidAt: Date | null },
    monthStart: Date,
    monthEnd: Date,
  ): PlannedExpenseStatus;
  /** due or overdue: what counts against the month's numbers. */
  export function isPlannedExpenseOutstanding(status: PlannedExpenseStatus): boolean;
  ```

- [ ] **Step 1: Write the failing tests** (Oct 2026 = `[2026-10-01, 2026-11-01)` local, built with `new Date(2026, 9, 1)` / `new Date(2026, 10, 1)`):
  - `due this month, unpaid` → `getPlannedExpenseStatus({ dueDate: new Date(2026,9,20,12), paidAt: null }, oct, nov)` is `"due"`
  - `due on the 1st` (`new Date(2026,9,1,12)`) → `"due"`; `due on the last day` (`new Date(2026,9,31,12)`) → `"due"`
  - `due before this month, unpaid` (`new Date(2026,8,20,12)`) → `"overdue"`
  - `due next month` (`new Date(2026,10,1,12)`) → `"upcoming"`
  - `paid this month` (`paidAt: new Date(2026,9,25)`) → `"paid"`
  - `paid exactly at monthEnd` (`paidAt: nov`) → `"due"` (not paid yet as of October)
  - `due Oct / paid 3 Nov viewed in October` → `"due"`; same bill viewed in November → `"paid"`
  - `overdue bill paid in a later month, viewed in the month between` (due Sep, paid Dec, viewed Oct) → `"overdue"`
  - `isPlannedExpenseOutstanding`: true for `due`/`overdue`, false for `paid`/`upcoming`
- [ ] **Step 2:** `npx vitest run src/lib/planned-expense-calc.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement per the spec §2 table. No Prisma import. Header comment explaining "paid is as of monthEnd so past months stay historical".
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(budget): planned bill status calculator (BUDGET-8)`.

### Task 3: Safe to spend counts planned bills

**Files:**
- Modify: `src/lib/safe-to-spend-calc.ts` (`computeSafeToSpend` ~213)
- Test: `src/lib/safe-to-spend-calc.test.ts`

**Interfaces:**
- Consumes: `PlannedExpenseStatus`, `isPlannedExpenseOutstanding` (Task 2).
- Produces:
  ```ts
  export type SafeToSpendPlannedExpense = { id: string; name: string; amount: number; status: PlannedExpenseStatus };
  // computeSafeToSpend({ ..., plannedExpenses?: SafeToSpendPlannedExpense[] })  default []
  ```
  Each outstanding one becomes an `expectedRecurring` row `{ categoryId: p.id, categoryName: p.name, amount: p.amount, type: "EXPENSE" }`.

- [ ] **Step 1: Write the failing tests:**
  - `adds due and overdue planned bills to due payments`: plannedExpenses `[{id:"p1",name:"Car repair",amount:3000,status:"due"},{id:"p2",name:"Dentist",amount:800,status:"overdue"}]`, income 20000, nothing else → `breakdown.duePayments === 3800`, `safeToSpend === 16200`, `expectedRecurring` contains `{categoryId:"p1",categoryName:"Car repair",amount:3000,type:"EXPENSE"}`.
  - `ignores upcoming and paid planned bills`: statuses `"upcoming"`, `"paid"` → `duePayments === 0`.
  - `does not suppress the repeat estimate`: a prior-month `isRecurring` EXPENSE transaction in category `c1` (amount 500) and a planned bill whose row would share nothing with `c1`; also no template. Result still has the `c1` row with amount 500 and `duePayments === 500 + planned amount`.
  - `no planned bills gives an identical result`: an existing fixture called with and without `plannedExpenses: []` → `toEqual`.
- [ ] **Step 2:** `npx vitest run src/lib/safe-to-spend-calc.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Add the param and push rows after the templates loop, before the sort. Do not touch `templateCategoryIds`. Extend the doc comment with one paragraph on why planned bills are a separate input.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(budget): count planned bills in safe to spend (BUDGET-8)`.

### Task 4: Planned bill Server Actions

**Files:**
- Create: `src/lib/share-split-form.ts` (moved parser, not a `"use server"` file)
- Modify: `src/app/dashboard/budget/actions.ts:663-701` (remove `parseTemplateSplitFormData`, call the moved one)
- Create: `src/app/dashboard/budget/planned-expense-actions.ts`
- Test: `src/app/dashboard/budget/planned-expense-actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // share-split-form.ts — the body of today's parseTemplateSplitFormData, moved verbatim;
  // its "must add up" message becomes the parameter.
  export const SPLIT_SUM_TOLERANCE = 0.01;
  export async function parseShareSplitFormData(
    formData: FormData, householdId: string, amount: number, sumMismatchError: string,
  ): Promise<{ error: string } | { householdMemberId: string; amountOwed: number }[] | null>;

  // planned-expense-actions.ts ("use server")
  export async function createPlannedExpenseAction(prev: ActionState, formData: FormData): Promise<ActionState>;
  export async function updatePlannedExpenseAction(prev: ActionState, formData: FormData): Promise<ActionState>; // needs "id"
  export async function deletePlannedExpenseAction(id: string): Promise<ActionState>;
  ```
  Form fields: `name`, `amount`, `categoryId`, `dueDate` (`YYYY-MM-DD`), and the split fields `splitEnabled`, `splitMemberId[]`, `splitAmount[]` (same names as the template dialog). `actions.ts` keeps `SPLIT_SUM_TOLERANCE` usage by importing it.

- [ ] **Step 1:** Move the parser. `actions.ts` calls `parseShareSplitFormData(formData, household.id, amount, "The split amounts must add up to the template's amount")`. Run `npx vitest run src/app/dashboard/budget/actions.test.ts` → still PASS (pure move).
- [ ] **Step 2: Write the failing tests**, mocking `@/lib/prisma` (`budgetCategory.findFirst`, `householdMember.findMany`, `plannedExpense.{create,findFirst,update,deleteMany}`, `plannedExpenseSplit.deleteMany`, `$transaction`), `@/lib/session`, `next/cache`, the same `vi.hoisted` pattern as `actions.test.ts`:
  - `create calls requireHousehold and scopes the category`: `budgetCategory.findFirst` called with `where: { id: "c1", householdId: "h1", type: "EXPENSE" }`.
  - `create rejects a missing name / amount ≤ 0 / bad date` → `{ error }`, no `create` call.
  - `create rejects a category from another household or a non-expense category` (findFirst → null) → `{ error: "Category not found" }`.
  - `create rejects a member from another household` (member findMany returns fewer) → error, no create.
  - `create rejects shares that don't add up` (3000 split 1000/1000) → `{ error: "The split amounts must add up to the bill's amount" }`.
  - `parses dueDate as UTC noon`: `dueDate: "2026-10-31"` → `create` data `dueDate` equals `new Date("2026-10-31T12:00:00Z")`.
  - `create happy path` → `plannedExpense.create` with `householdId: "h1"`, `createdByUserId: "u1"`, `splits: { create: [...] }`; `revalidatePath` called for `/dashboard/budget`, `/dashboard/personal-budget`, `/dashboard`; returns `{}`.
  - `update scopes by household and replaces splits in one $transaction`: `plannedExpense.findFirst` with `{ id, householdId: "h1" }`; `$transaction` receives `plannedExpenseSplit.deleteMany` then `plannedExpense.update`. A foreign id (findFirst → null) → `{ error: "Planned bill not found" }`.
  - `delete is scoped by household`: `plannedExpense.deleteMany({ where: { id: "p1", householdId: "h1" } })`; count 0 → `{ error: "Planned bill not found" }`.
- [ ] **Step 3:** `npx vitest run src/app/dashboard/budget/planned-expense-actions.test.ts` → FAIL.
- [ ] **Step 4:** Implement. Zod schema: `name` trimmed 1–100, `amount` `z.coerce.number().positive()`, `categoryId` min 1, `dueDate` regex `^\d{4}-\d{2}-\d{2}$` → `new Date(\`${d}T12:00:00Z\`)`. Errors through `toFriendlyError` like `actions.ts`. Update does not touch the linked transaction.
- [ ] **Step 5:** Re-run → PASS.
- [ ] **Step 6:** Commit `feat(budget): planned bill actions (BUDGET-8)`.

### Task 5: Log a payment against a planned bill

**Files:**
- Modify: `src/app/dashboard/budget/actions.ts` (`transactionSchema` ~250, `parseTransactionFormData` ~264, `createTransactionAction` ~407)
- Test: `src/app/dashboard/budget/actions.test.ts`

**Interfaces:**
- Consumes: Task 1's `Transaction.plannedExpenseId`.
- Produces: `createTransactionAction` accepts form field `plannedExpenseId`; on success the created transaction has `plannedExpenseId` set. Error copy: `"Planned bill not found"`, `"This planned bill is already paid"`.

- [ ] **Step 1: Write the failing tests** (add `plannedExpense.findFirst` to the existing prisma mock):
  - `links the transaction to a planned bill`: findFirst → `{ id: "p1", transaction: null }` → `transaction.create` data includes `plannedExpenseId: "p1"`; findFirst called with `where: { id: "p1", householdId: "h1" }`.
  - `rejects a planned bill from another household` (findFirst → null) → `{ error: "Planned bill not found" }`, no create.
  - `rejects an already paid planned bill` (findFirst → `{ id: "p1", transaction: { id: "t9" } }`) → `{ error: "This planned bill is already paid" }`.
  - `maps a unique-constraint race to the already-paid error`: `transaction.create` rejects with a `Prisma.PrismaClientKnownRequestError` code `P2002`, `meta.target` including `plannedExpenseId` → same error.
  - `without plannedExpenseId nothing changes`: existing create test asserts `plannedExpenseId: null`.
- [ ] **Step 2:** `npx vitest run src/app/dashboard/budget/actions.test.ts` → new tests FAIL.
- [ ] **Step 3:** Add `plannedExpenseId: z.string().optional()`, a `resolvePlannedExpenseId(householdId, id)` helper next to `resolveRecurringTemplateId`, write `plannedExpenseId: planned.id ?? null`, and catch the P2002 before `toFriendlyError`. `updateTransactionAction` and the personal-budget action are unchanged.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(budget): log a payment against a planned bill (BUDGET-8)`.

### Task 6: Planned bills panel, dialog and household page wiring

**Files:**
- Create: `src/components/budget/planned-expense-dialog.tsx`, `src/components/budget/planned-expenses-panel.tsx`
- Modify: `src/components/budget/transaction-dialog.tsx:142-155,210,249,301` (prefill)
- Modify: `src/app/dashboard/budget/page.tsx` (query in the `Promise.all` ~372, statuses, `computeSafeToSpend` ~625, `manage` ~737)
- Modify: `src/lib/i18n/dictionaries/en.ts`, `sv.ts` (new `budget.planned` block), and `src/components/budget/budget-dict.ts` if it narrows the dict type
- Create: `e2e/planned-expenses.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  ```ts
  // planned-expenses-panel.tsx
  export type PlannedExpenseRow = {
    id: string; name: string; amount: number; dueDate: Date;
    categoryId: string; categoryName: string;
    status: PlannedExpenseStatus;
    splits: { householdMemberId: string; amountOwed: number }[];
  };
  // transaction-dialog.tsx — TransactionTemplatePrefill becomes:
  // { templateId?: string; plannedExpenseId?: string; categoryId; amount; description?;
  //   frequency?: RecurrenceFrequency; splits? }
  // isRecurring defaults to !!prefillFromTemplate?.templateId; hidden input
  // "recurringTemplateId" only when templateId is set, "plannedExpenseId" only when that is set.
  ```
  Dictionary block `budget.planned`: `title`, `subtitle`, `empty`, `add`, `edit`, `delete`, `deleteConfirm`, `logPayment`, `groupOverdue`, `groupDue`, `groupUpcoming`, `groupPaid`, `dueOn` (`"Due {date}"`), `splitWays` (`{ one, other }`), `nameLabel`, `amountLabel`, `categoryLabel`, `dueDateLabel`, `splitLabel`, `save`, `savedToast`, `deletedToast`, `overdueBadge`. Swedish: Planerade räkningar, Försenad, Kommande, Betald, Lägg till planerad räkning, Logga betalning, Förfaller {date}.

- [ ] **Step 1: Write the failing e2e test** `e2e/planned-expenses.spec.ts` (seed an `EXPENSE` category in `E2E_HOUSEHOLD` via `pg` like `personal-budget-shared.spec.ts`; `dismissCookieNotice` in `beforeEach`; `unique()` name with `E2E_WORKER`):
  - `adds a planned bill, then logs its payment`: go to `/dashboard/budget?tab=manage`; click button "Add planned bill"; fill Name, Amount `3000`, pick the category, leave Due date as today, tick "Split this bill", Save; reload; expect the name under heading "Due this month" with text "Due". Go to the Overview tab and expect the Safe to spend breakdown to list the name. Back on Manage, click "Log payment" on the row; the transaction dialog's Amount field has value `3000`; Save; reload; expect the name under "Paid", and in the Transactions tab expect a row with the name.
  - Last steps of the same test: delete the transaction through the Transactions tab's delete action, then reload Manage and expect the bill back under "Due this month" (Review Focus 4).
  - Cleanup (`afterEach`, via pg, scoped by `E2E_HOUSEHOLD.id`): delete the planned bill and the seeded category.
  - `expectNoHorizontalOverflow(page)` with the dialog open.
- [ ] **Step 2:** `npm run build && npx playwright test e2e/planned-expenses.spec.ts` → FAIL (no "Add planned bill").
- [ ] **Step 3:** Add the dictionary block in both languages (`sv.ts satisfies Dictionary` catches gaps).
- [ ] **Step 4:** `PlannedExpenseDialog`: modelled on `RecurringTemplateDialog` (same Dialog/Sheet, same share-only split section with `evenSplitAmounts`, shown only when `members.length > 1`). Fields named per Task 4. Date input `type="date"` defaulting to today in local time. Form action via `useActionState`, toast on success, inline error.
- [ ] **Step 5:** `PlannedExpensesPanel` props: `{ rows: PlannedExpenseRow[]; categories; members; currentMemberId; monthKey; dict; locale; currencyCode; createAction; updateAction; onDelete: (id: string) => Promise<ActionState>; createTransactionAction; updateTransactionAction }`. Card with title and "Add planned bill" (one primary). Groups in order overdue, due, upcoming, paid; empty groups hidden; empty state when no rows. Overdue rows: destructive-tinted text + `AlertCircle` icon + `overdueBadge` text. Row actions: Log payment (a `TransactionDialog` trigger with `prefillFromTemplate={{ plannedExpenseId, categoryId, amount, description: name, splits }}`; hidden when paid), Edit (dialog), Delete (confirm, `useTransition`; hidden when paid). Targets `min-h-11` on phones.
- [ ] **Step 6:** `TransactionDialog` prefill change as in Interfaces. The recurring-template callers keep passing `templateId` + `frequency`, so their behaviour is unchanged.
- [ ] **Step 7:** `page.tsx`: add to the `Promise.all`
  `prisma.plannedExpense.findMany({ where: { householdId, OR: [{ transaction: { is: null } }, { transaction: { is: { date: { gte: monthStart } } } }] }, include: { category: true, splits: true, transaction: { select: { date: true } } }, orderBy: { dueDate: "asc" } })`.
  Map to `PlannedExpenseRow` with `getPlannedExpenseStatus({ dueDate, paidAt: transaction?.date ?? null }, monthStart, monthEnd)`. Pass `plannedExpenses: rows.map(({id,name,amount,status}) => ({id,name,amount,status}))` to `computeSafeToSpend`. Render `<PlannedExpensesPanel>` in `manage` directly after `RecurringTemplatesPanel`.
- [ ] **Step 8:** Re-run the e2e on desktop and mobile → PASS. `npx vitest run` → PASS.
- [ ] **Step 9:** Look at the mobile screenshot of the Manage tab in en and sv (`saveScreenshot` or a manual `page.screenshot`) and check the DESIGN.md checklist.
- [ ] **Step 10:** Commit `feat(budget): planned bills panel and dialog (BUDGET-8)`.

### Task 7: Planned bills in the due strip

**Files:**
- Modify: `src/components/budget/due-recurring-widget.tsx`, `src/components/budget/budget-tabs.tsx` (~190-310), `src/app/dashboard/budget/page.tsx` (`<BudgetTabs>` ~887)
- Modify: `e2e/planned-expenses.spec.ts`

**Interfaces:**
- Consumes: `PlannedExpenseRow` (Task 6), `dict.budget.planned`.
- Produces: `DueRecurringWidget` prop `plannedDue?: PlannedExpenseRow[]` (default `[]`, already filtered to outstanding); `BudgetTabs` prop `plannedDue?: PlannedExpenseRow[]` passed through.

- [ ] **Step 1: Extend the e2e test:** after Save and reload, on the Overview tab expect the due strip (region with the `dueWidget.title` heading) to contain the bill's name and a "Log payment" button.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Render outstanding planned rows in the widget's list after the templates: name, amount, "Due {date}" or the overdue badge, and a Log payment `TransactionDialog` trigger with the same prefill as the panel. The widget treats `plannedDue.length > 0` as having content, so the "nothing set up" empty state doesn't show. Page passes `plannedDue={plannedRows.filter(r => isPlannedExpenseOutstanding(r.status))}`.
- [ ] **Step 4:** Re-run → PASS (desktop and mobile).
- [ ] **Step 5:** Commit `feat(budget): show planned bills in the due strip (BUDGET-8)`.

### Task 8: The user's share in Personal Budget

**Files:**
- Modify: `src/lib/personal-budget-position.ts` (after the shared-template block ~300-345, and the `expectedRecurring` fold ~466)
- Modify: `src/components/budget/due-recurring-widget.tsx` (`SharedDueRow.logPrefill` optional; Log payment only when set)
- Test: `src/lib/personal-budget-position.test.ts` (create if absent, mocking `@/lib/prisma` like `actions.test.ts`)
- Modify: `e2e/planned-expenses.spec.ts`

**Interfaces:**
- Consumes: `getPlannedExpenseStatus`, `isPlannedExpenseOutstanding` (Task 2).
- Produces: `sharedDueRows` also contains planned rows `{ id: plannedExpense.id, name, categoryName, type: "EXPENSE", amount: split.amountOwed, householdName }` with no `logPrefill`. They're included in `expectedRecurring` by the existing `sharedDueRows` fold, so no second fold is needed.

- [ ] **Step 1: Write the failing tests:**
  - `adds the user's share of an outstanding planned bill`: `plannedExpenseSplit.findMany` → one split `{ householdMemberId: "m1", amountOwed: 1500, plannedExpense: { id: "p1", name: "Car repair", amount: 3000, dueDate: <in month>, category: { name: "Car" }, transaction: null } }` → `sharedDueRows` contains `{ id: "p1", amount: 1500, type: "EXPENSE" }` and `safeToSpendBreakdown.duePayments` includes 1500.
  - `query is bounded`: `plannedExpenseSplit.findMany` called with `where.householdMemberId.in` = the user's member ids, `where.amountOwed: { gt: 0 }`, and `where.plannedExpense.dueDate: { lt: monthEnd }`.
  - `a bill paid before monthEnd is not added` (transaction date inside the month) → no row.
  - If an existing test file doesn't exist, add only these; mock the other prisma calls to return `[]`.
- [ ] **Step 2:** `npx vitest run src/lib/personal-budget-position.test.ts` → FAIL.
- [ ] **Step 3:** Implement: one `plannedExpenseSplit.findMany` (skipped when `householdMemberIds` is empty), with `where: { householdMemberId: { in }, amountOwed: { gt: 0 }, plannedExpense: { dueDate: { lt: monthEnd } } }`, including `plannedExpense: { include: { category: { select: { name: true } }, transaction: { select: { date: true } } } }`. Filter by `isPlannedExpenseOutstanding(getPlannedExpenseStatus(...))` and append to `sharedDueRows`. Make `logPrefill` optional in `SharedDueRow` and guard its use in the widget. The "View in {household} Budget" link still renders.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5: Extend the e2e:** after creating the split bill, visit `/dashboard/personal-budget`; expect the bill's name with the "Shared" badge and its 1500 share, and no "Log payment" button in that row. (The seed's personal category insert from `personal-budget-shared.spec.ts` is needed so Overview renders; copy that statement.)
- [ ] **Step 6:** `npm run build && npx playwright test e2e/planned-expenses.spec.ts` → PASS.
- [ ] **Step 7:** Commit `feat(personal-budget): show your share of planned bills (BUDGET-8)`.

### Task 9: Docs, full verification, self-review

**Files:**
- Modify: `REQUIREMENTS.md` (new "Planned bills" subsection after "Household expense splitting" ~2261; one line in "Safe to spend" ~2128; one line in the Personal Budget shared section), `BACKLOG.md` (delete BUDGET-8, lines ~332-347)

- [ ] **Step 1:** Write the REQUIREMENTS.md subsection: model, statuses table, where it counts, logging, deletes, what's out of scope (spec "Out of scope").
- [ ] **Step 2:** Delete the BUDGET-8 entry from BACKLOG.md.
- [ ] **Step 3:** `npm run check && npm run build` → all green. Then `npm run test:e2e:quick` → green.
- [ ] **Step 4:** Run the `self-review` skill on `git diff origin/next...`. Fix findings, re-run the affected checks.
- [ ] **Step 5:** Commit `docs: document planned bills (BUDGET-8)`.
- [ ] **Step 6:** Ask the owner before pushing and opening the PR. The PR is titled `feat: planned bills for one-off shared costs (BUDGET-8)`, with the template filled in, an en+sv release note, and a flag for human review (human-only money area).
