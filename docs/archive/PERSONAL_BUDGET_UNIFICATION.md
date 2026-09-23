# Personal Budget unification — design spike (2026-09-15)

Source: item J of `UX_CONSISTENCY_BACKLOG.md` (Wave 3). That item observes that
`src/components/personal-budget/` duplicates `src/components/budget/`'s component tree file-
for-file instead of parameterizing one implementation by scope, which is why Wave 1 fixes
(shared `Checkbox`, dashed-box empty state, shared `Tabs`, toast-based success feedback) each
need a second, easy-to-forget pass over the personal-budget tree to stay consistent.

**This document is a plan only.** No component, action, or schema code was changed while
producing it. It's meant to be handed back for a human decision on wave/effort before any
implementation task is scoped from it, per item J's instructions.

Status legend (for the proposed follow-up tasks in "Proposed implementation waves" below):
`[ ]` not started · `[~]` in progress (agent dispatched) · `[x]` merged to master ·
`[!]` blocked / needs a human decision.

## 1. Recommendation

**Unify the component layer behind a `scope`-aware prop contract; leave the Prisma data
layer alone.**

The two Prisma model families (`BudgetCategory`/`Transaction`/`RecurringTemplate`/
`RecurringTemplateAck`, scoped by `householdId`, vs. `PersonalBudgetCategory`/
`PersonalTransaction`/`PersonalRecurringTemplate`/`PersonalRecurringTemplateAck`, scoped by
`userId`) are already an intentional, documented duplication —
`prisma/schema.prisma:696-699`'s comment on `PersonalRecurringTemplate` says outright: *"Kept
as a straight duplicate rather than a shared/polymorphic table, same convention as
PersonalBudgetCategory/PersonalTransaction themselves."* Collapsing that into one
polymorphic/nullable-owner schema would be a materially bigger, riskier, migration-bearing
change than what item J is asking for, and isn't justified by a UX-consistency audit. **This
plan does not propose touching `prisma/schema.prisma` or either `actions.ts` file's Prisma
calls.** The two `app/dashboard/{budget,personal-budget}/page.tsx` Server Components also stay
separate, since they fetch from different Prisma delegates with genuinely different shapes
(household members / splits exist only on one side).

What *should* unify is everything downstream of that data-fetching: the ~10 Client/
presentational components that re-implement the same JSX, validation-adjacent UI, and
interaction patterns twice. Two possible shapes were considered:

- **(A) A `scope: "household" | "personal"` prop threaded through one shared component,**
  branching internally on `scope` for the handful of places that actually differ (which
  action to call, which dict namespace, whether split/member UI renders).
- **(B) One shared base component + two thin wrapper components**, each wrapper supplying the
  scope-specific bits as props to the shared base.

**Recommend (B), but note it's nearly free for most of these pairs** because of something the
audit below found: `TransactionDialog`, `TransactionList`, `DueRecurringWidget`, and
`RecurringTemplatesPanel` already gate every household-only section (the split UI, the "paid
by" badge, the member picker) behind `members.length > 1` / `canSplit`. A personal-scope
wrapper that simply passes `members={[]}` and `currentMemberId=""` into the existing household
component already suppresses all of that UI correctly — no new conditional branches needed in
the shared component itself for those four pairs. This matches this repo's existing
`mode="create"|"edit"` convention (`ItemFormDialog`, referenced by backlog item H) better than
a `scope` enum would: a thin wrapper per surface, not a branch-per-field inside one file.

The remaining pairs (`CategoryManager`, `BudgetTabs`, `BudgetOnboarding`) differ in more than
"pass an empty array" ways (see §3) and need an explicit `scope`/injected-actions prop rather
than an empty-array trick — for those, thread the two server actions in as props (e.g.
`createCategoryAction: (prevState, formData) => Promise<ActionState>`) instead of having the
shared component import a hardcoded action module, since the actions themselves stay separate
per §1's data-layer decision.

## 2. What's already shared (don't re-merge this)

Not everything is duplicated today — three pieces are already imported directly by both pages,
confirming the codebase already has precedent for scope-agnostic shared budget code:

- `src/components/budget/period-summary.tsx` (`PeriodSummary`) — imported as-is by
  `personal-budget/page.tsx`.
- `src/components/budget/fixed-budget-summary.tsx` (`FixedBudgetSummary`) — same.
- `src/lib/safe-to-spend-calc.ts` and `src/lib/recurring-template-calc.ts` — pure calc
  helpers, fed household or personal rows interchangeably by each page.
- `src/components/budget/safe-to-spend.tsx` (`SafeToSpend`) — imported directly into
  `personal-budget-tabs.tsx`.

These already prove the "one component, fed different data" pattern works here; the plan below
just extends it to the remaining pairs.

## 3. File-pair inventory

| Household (`src/components/budget/`) | Personal (`src/components/personal-budget/`) | Merge shape |
|---|---|---|
| `transaction-dialog.tsx` (`TransactionDialog`) | `personal-transaction-dialog.tsx` (`PersonalTransactionDialog`) | Thin wrapper passing `members=[]`; personal action injected as prop |
| `transaction-list.tsx` (`TransactionList`) | `personal-transaction-list.tsx` (`PersonalTransactionList`) | Thin wrapper passing `members=[]` |
| `category-manager.tsx` (`CategoryManager`, `AddCategoryDialog`) | `personal-category-manager.tsx` (`PersonalCategoryManager`, its own `AddCategoryDialog`) | Needs injected actions + dict namespace; not a pure empty-array case |
| `recurring-template-dialog.tsx` (`RecurringTemplateDialog`) | `personal-recurring-template-dialog.tsx` | Near-identical; only import paths/ids/dict differ — straightforward merge |
| `recurring-templates-panel.tsx` (`RecurringTemplatesPanel`) | `personal-recurring-templates-panel.tsx` | Thin wrapper passing `members=[]`; injected actions |
| `due-recurring-widget.tsx` (`DueRecurringWidget`) | `personal-due-recurring-widget.tsx` | Thin wrapper passing `members=[]` |
| `budget-tabs.tsx` (`BudgetTabs`) | `personal-budget-tabs.tsx` (`PersonalBudgetTabs`) | Needs a real `scope`/feature-flag prop — personal has 2 tabs vs. household's up-to-4, and is missing the "Manage categories" affordance (see §5) |
| `budget-onboarding.tsx` (`BudgetOnboarding`) | `personal-budget-onboarding.tsx` | Personal is missing the starter-category-picker section entirely (see §5) — needs a product decision, not just a merge |
| `starter-category-picker.tsx` | *(none)* | Household-only feature; no personal equivalent exists at all |
| `split-amounts.ts` / `split-amounts.test.ts` | *(none)* | Household-only (expense splitting has no personal-budget meaning); stays as-is |
| `cost-analyzer.tsx` | *(none)* | Household-only (fed from shared `PriceHistory`, a household-scoped model); no personal equivalent expected |
| `household-balances.tsx` | *(none)* | Household-only ("who owes whom" has no meaning for a single person); no personal equivalent expected |
| `period-summary.tsx` | *(shared already — see §2)* | Already unified |
| `fixed-budget-summary.tsx` | *(shared already — see §2)* | Already unified |
| `safe-to-spend.tsx` | *(shared already — see §2)* | Already unified |
| *(N/A)* | *(N/A)* | `app/dashboard/budget/actions.ts` vs. `app/dashboard/personal-budget/actions.ts` — **out of scope for this merge**, see §1 |
| *(N/A)* | *(N/A)* | `app/dashboard/budget/page.tsx` vs. `app/dashboard/personal-budget/page.tsx` — **out of scope**, stay separate Server Components |

That's **7 real component pairs** to merge (not counting the 3 already-shared pieces and the 3
household-only files that have no personal counterpart by design), a smaller and more tractable
set than "the entire tree duplicates" suggests.

## 4. Behavioral differences found (don't assume parity)

Diffing both trees line-by-line (after normalizing `Personal`-prefixed names) surfaced these —
most are intentional scope differences, but two are real gaps worth a product decision:

- **Missing starter-category picker for Personal Budget** (feature gap, not style). Household's
  `budget-onboarding.tsx` renders `AddCategoryDialog` *and* `StarterCategoryPicker` (a one-click
  "add a starter set of categories" shortcut) separated by a divider.
  `personal-budget-onboarding.tsx` only renders the manual `AddCategoryDialog` — a user setting
  up their personal budget for the first time gets no starter-set shortcut at all. This is a
  feature parity gap, not a copy-paste-and-fix-later drift; scoping it needs a product call
  (does personal budget want the same starter categories, a different personal-oriented set, or
  none intentionally?).
- **Missing "Manage categories" tab-bar affordance for Personal Budget** (a second, adjacent
  drift, from `UX_FRICTION_BACKLOG.md` item 7, not one of the four items J names). Household's
  `budget-tabs.tsx` renders a persistent "Manage categories" button next to the tab bar
  (opening `CategoryManager` in a `Dialog`) specifically so category management has "one stable
  home regardless of onboarding state" (its own doc comment cites `UX_FRICTION_BACKLOG.md` item
  7). `personal-budget-tabs.tsx` has no equivalent — `PersonalCategoryManager` is only reachable
  via the Activity tab's overview panel. Same root cause as item J (independent trees, one
  fixed, one not), just from a different backlog.
- **`deleteCategoryAction` error handling differs.** The household version
  (`app/dashboard/budget/actions.ts:164-168`) wraps `prisma.budgetCategory.delete` in a
  `try/catch` → `toFriendlyError`. The personal version
  (`app/dashboard/personal-budget/actions.ts:61`) calls
  `prisma.personalBudgetCategory.delete` with no `try/catch` at all — an unexpected Prisma
  error (e.g. a race where the category gained a transaction between the check and the delete)
  would throw an unhandled error in the personal path instead of returning a friendly
  `ActionState.error` like every other mutation in both files. Worth fixing regardless of the
  unification decision.
- **Expense splitting is intentionally household-only** — `TransactionDialog`'s split section,
  `TransactionList`'s "paid by" badge, `HouseholdBalances`, and `split-amounts.ts` have no
  personal-budget analog, correctly, since a personal budget has exactly one participant. This
  is scope, not drift — confirmed by reading `parseSplitFormData` in the household actions file,
  which validates against `householdMember`, a concept that doesn't exist per-user.
- **Cost analyzer and cross-household balances are correctly household-only** — fed from
  `PriceHistory` (household-scoped) and multi-member settle-up math respectively; no equivalent
  expected or missing on the personal side.
- Everything else diffed (both `recurring-template-dialog.tsx` pair, both
  `recurring-templates-panel.tsx` pair, both `due-recurring-widget.tsx` pair, both
  `transaction-list.tsx` pair) came back logic-for-logic identical once normalized — the only
  diffs were `id`/`htmlFor` string suffixes (`rt-*` vs. `prt-*`), import paths, and dict
  namespace (`dict.budget` vs. `dict.personalBudget`). These are the safest, closest-to-
  mechanical merges in the set.

## 5. Wave 1 drift audit — which fixes already reached personal-budget

Checked directly against the current `master` (this worktree's own base predates Wave 1, so its
copies of these files are pre-fix; the check below reads `master`'s content via `git show`, not
this worktree's working tree):

| Wave 1 fix | Applied to `src/components/budget/` | Applied to `src/components/personal-budget/` |
|---|---|---|
| **B. Shared `Checkbox`** (`src/components/ui/checkbox.tsx`) | Yes — `transaction-dialog.tsx` imports and uses `<Checkbox>` for both the recurring and split toggles | **No** — `personal-transaction-dialog.tsx:197` still hand-rolls `<input type="checkbox" className="size-4">` for the recurring toggle |
| **C. Dashed-box empty state** | Yes — `category-manager.tsx`'s empty state is `rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground` | **No** — `personal-category-manager.tsx:69` still renders the old bare `<p className="text-sm text-muted-foreground">` with no border/padding/centering |
| **D. Shared `Tabs`** (`src/components/ui/tabs.tsx`) | Yes — `budget-tabs.tsx` renders `<Tabs tabs={tabItems} value={tab} onChange={setTab} />` | **No** — `personal-budget-tabs.tsx` still hand-rolls its own two `<Button variant={tab === x ? "secondary" : "ghost"}>` pill buttons inside a `bg-muted` wrapper div |
| **E. Toast-based success feedback** | N/A to this tree (item E was scoped to Profile forms) — but both trees already use `toast.success`/`toast.error` throughout their recurring-template and transaction-dialog actions, so there's nothing to drift here | Already consistent — every mutation result in `personal-recurring-templates-panel.tsx`, `personal-due-recurring-widget.tsx`, `personal-budget-onboarding.tsx`, and `personal-transaction-dialog.tsx` is surfaced via `toast.success`/`toast.error`, same as the household tree |

Three of the four Wave 1 fixes (B, C, D) have concretely drifted into the personal-budget tree
exactly as item J predicted — each is a small, independent, low-risk fix that could be applied
directly to the two or three affected files without waiting on the larger unification described
above, if a human wants a quick partial win before scoping the full merge.

## 6. Proposed implementation waves (not started — for a human to schedule)

These are sketched for scoping purposes only; none are dispatched by this spike.

- [ ] **1. Quick-win catch-up patches** — apply Wave 1 items B, C, D directly to
      `personal-transaction-dialog.tsx`, `personal-category-manager.tsx`, and
      `personal-budget-tabs.tsx` without waiting on the structural merge below. Lowest risk,
      immediately removes the most visible drift, and isn't invalidated by whatever the
      unification decision turns out to be (the shared `Checkbox`/`Tabs` components are used
      either way). Also fix the `deleteCategoryAction`/`deletePersonalCategoryAction`
      try/catch inconsistency (§4) while touching that file.
- [ ] **2. Merge the four "empty-array-safe" pairs** — `TransactionDialog`+
      `PersonalTransactionDialog`, `TransactionList`+`PersonalTransactionList`,
      `RecurringTemplatesPanel`+`PersonalRecurringTemplatesPanel`,
      `DueRecurringWidget`+`PersonalDueRecurringWidget`, plus `RecurringTemplateDialog`+
      `PersonalRecurringTemplateDialog` (mechanical, no members prop involved). Delete the five
      `personal-*` files; both pages import the shared component with `members={[]}`/
      `currentMemberId=""` from the personal-budget page and real values from the household
      page. This is 5 of the 7 pairs and the least risky half.
- [ ] **3. Merge `CategoryManager`/`AddCategoryDialog`** — needs the two create/delete actions
      injected as props (or a small per-scope action-selector) rather than empty-array
      suppression. Depends on nothing in wave 2 but touches a component wave 2 doesn't.
- [ ] **4. Merge `BudgetTabs`/`PersonalBudgetTabs`** — needs an explicit prop for which
      optional tabs exist (`costAnalyzer`/`balances` become optional `ReactNode`s the way
      `balances` already is) and a decision on the "Manage categories" affordance gap (§4)
      before or as part of the merge. Should land after wave 3 since it renders
      `CategoryManager` inline.
- [ ] **5. Product decision, then merge, `BudgetOnboarding`/`PersonalBudgetOnboarding`** —
      blocked on a human decision about the missing starter-category picker (§4): give personal
      budget its own starter set, reuse the household one, or document its absence as
      intentional. Do the structural merge only after that's decided, so the merge doesn't
      accidentally ship or hide a product decision as a side effect.

Waves 2-5 together are the "collapse `src/components/personal-budget/`" work; wave 1 can ship
independently and immediately per this backlog's own Wave-1 precedent (independent, parallel,
disjoint files).

## 7. Open questions for a human

- Does personal budget's missing starter-category picker (§4) get its own category set, reuse
  the household one verbatim, or stay manual-only by design? Blocks wave 5.
- Is the missing "Manage categories" tab-bar shortcut (§4) worth fixing at all for personal
  budget, given it only has one category-bearing tab already visible (Activity) vs. household's
  up-to-four tabs where the shortcut matters more? Could be scoped out as "not actually needed
  at personal budget's smaller scale" rather than treated as a bug.
- Whether to also unify `app/dashboard/budget/actions.ts` and
  `.../personal-budget/actions.ts` behind a shared repository-style abstraction (e.g. an
  injected `{ findCategory, createCategory, deleteCategory, ... }` object per scope) is
  explicitly left open rather than recommended against outright — §1 argues against merging the
  underlying Prisma models, but a thinner action-level abstraction is a separate, smaller
  question a human may still want scoped later once the component merge (waves 2-5) is done and
  the actual prop surface each component needs is known.
