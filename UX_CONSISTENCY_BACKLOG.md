# UX consistency backlog — 2026-09-15 review

Source: a product-design consistency audit (2026-09-15) of how the app handles create/edit/
delete flows, navigation, feedback, empty states, and shared UI primitives across its
feature areas (Inventory, Shopping List, Meal Planning/Recipes, Tasks, Budget, Personal
Budget, Household, Profile). The app has a real shared component kit
(`src/components/ui/`: Button, Input, Select, Dialog, Table, ConfirmDialog, Sonner) that is
used consistently almost everywhere — the items below are the specific places where a
feature drifted from that baseline, broken into tasks scoped the same way
`PRODUCTION_READINESS.md`, `MAINTENANCE_BACKLOG.md`, and `SCALABILITY_BACKLOG.md` were —
each is self-contained enough to hand to an isolated subagent in its own git worktree/
branch with no other context from the review.

Status legend: `[ ]` not started · `[~]` in progress (agent dispatched) ·
`[x]` merged to master · `[!]` blocked / needs a human decision.

Every task below that adds or changes user-visible copy must add both English and Swedish
strings (`src/lib/i18n/dictionaries/en.ts` / `sv.ts` — `satisfies Dictionary` fails the
build if a key is missing in either locale).

## Wave 1 — independent, parallel (disjoint files, no shared-component changes)

- [~] **A. Add a confirmation step to shopping-list item delete** —
      `src/components/shopping/shopping-list-client.tsx:479-493`. Deleting a shopping
      *list* already confirms via `ConfirmDialog`
      (`src/components/shopping/shopping-lists-overview.tsx:316-334`), but deleting an
      *item within that list*, on the same page, fires `deleteShoppingListItemAction`
      immediately on icon click with no confirmation — the one delete path in the app that
      doesn't confirm, and it sits right next to one that does. Wrap the existing delete
      button in the same `ConfirmDialog` pattern used elsewhere (see
      `src/components/inventory/item-actions.tsx:92-110` or
      `src/components/tasks/tasks-client.tsx:271-289` for the reference shape: a
      `ConfirmDialog` with a title/description and an `onConfirm` that calls the existing
      `startTransition(() => deleteShoppingListItemAction(...))` logic already in this
      file). Do not change the action itself, only gate the click behind a confirmation.
      Reuse existing i18n keys for "Delete"/"Cancel"/confirmation copy if this repo already
      has them (check `shopping-lists-overview.tsx`'s delete-list confirmation strings
      first); add new keys only if needed. Verify with `npm run lint`, `npx tsc --noEmit`,
      `npm run test`, and a manual check in the browser that deleting a shopping-list item
      now requires confirming.

- [~] **B. Extract a shared `Checkbox` component and adopt it everywhere** —
      new file `src/components/ui/checkbox.tsx`. Every feature currently hand-rolls its own
      native `<input type="checkbox">` with a different (or no) className, so the same
      control renders differently across the app: unstyled/bare in
      `src/components/inventory/inventory-table.tsx:322-327,353-358`, `className="size-4
      shrink-0"` in `src/components/shopping/shopping-list-client.tsx:439-449` and
      `src/components/tasks/tasks-client.tsx:228-240`, `className="size-4 accent-primary"`
      in `src/components/meal-planning/mark-cooked-dialog.tsx:134-137` (the only one
      actually tinted with the brand color), and a bare untyped checkbox in
      `src/components/budget/transaction-dialog.tsx:244-289`. Build one `Checkbox`
      component in `components/ui/` (follow this repo's existing shadcn-style wrapper
      pattern used by e.g. `components/ui/select.tsx` — base it on a plain styled
      `<input type="checkbox">` since this repo doesn't currently pull in a Radix/Base-UI
      checkbox primitive; check `@base-ui/react`'s package exports first in case it already
      has one before hand-rolling), give it a single consistent visual treatment (use the
      `accent-primary` variant from `mark-cooked-dialog.tsx` as the reference look since
      it's the only one that's actually on-brand today), and replace all five call sites
      above with it, preserving each one's existing `checked`/`onChange`/`disabled` wiring
      exactly. Verify with `npm run lint`, `npx tsc --noEmit`, `npm run test`, and a manual
      visual check of each of the five screens (inventory bulk-select, shopping list
      purchased-toggle, tasks complete-toggle, mark-cooked dialog, budget transaction
      recurring/split toggles) to confirm the checkbox now looks identical across all of
      them.

- [~] **C. Fix the Budget categories empty state to match the shared convention** —
      `src/components/budget/category-manager.tsx:62`. Every other list view's empty state
      uses `rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground`
      (see `src/components/inventory/inventory-table.tsx:151`,
      `src/components/budget/transaction-list.tsx:86`,
      `src/components/meal-planning/recipe-manager.tsx:67,85`,
      `src/components/tasks/tasks-client.tsx:161`, and five more listed in the audit —
      grep for that exact className string to find every current usage before editing).
      Budget's category list instead renders a bare `<p className="text-sm
      text-muted-foreground">{dict.categories.empty}</p>` with no border/padding/centering.
      Change it to match the shared dashed-box pattern used everywhere else, reusing the
      existing `dict.categories.empty` copy. Verify with `npm run lint`, `npx tsc
      --noEmit`, `npm run test`, and a manual check: a household with zero budget
      categories shows the same dashed-box empty state as an empty inventory/task/recipe
      list.

- [x] **D. Share one `Tabs` sub-navigation component between Budget and Meal Planning** —
      Merged `1205755`. New `src/components/ui/tabs.tsx` wraps `@base-ui/react/tabs`;
      `budget-tabs.tsx` and `meal-planning-view.tsx` both use it now. Visual/behavioral
      parity verified manually; `personal-budget-tabs.tsx` intentionally left as-is
      (scoped to item J instead). Full suite green (lint/tsc/649 tests).
      `src/components/budget/budget-tabs.tsx` and the equivalent pill-tab component in
      `src/components/meal-planning/meal-planning-view.tsx`. These are two independently
      written implementations of the same pill-button tab pattern — the comment at
      `budget-tabs.tsx:3-7` explicitly says it "mirrors MealPlanningView's pill-button tab
      pattern" rather than reusing it, meaning any future visual tweak has to be applied
      twice by hand. Extract one shared `Tabs`-style component into
      `src/components/ui/` (there is currently no `tabs.tsx` in that directory — check
      `@base-ui/react`'s exports for an existing tabs primitive to wrap before hand-rolling
      one, matching how `components/ui/select.tsx` wraps its Base-UI equivalent), taking a
      list of `{ value, label }` tab definitions plus the active value and an `onChange`,
      and preserving the exact current visual styling (don't restyle — this task is about
      deduplicating the implementation, not changing how tabs look). Replace both
      `budget-tabs.tsx`'s and meal-planning's internal tab markup with the new shared
      component, keeping each call site's own tab list/labels/routing logic as-is. Verify
      with `npm run lint`, `npx tsc --noEmit`, `npm run test`, and a manual check that both
      the Budget and Meal Planning tab bars still look and behave identically to before.

- [~] **E. Convert Profile's inline success text to the shared toast pattern** —
      `src/components/profile/display-name-form.tsx:43` and the equivalent block in
      `src/components/profile/email-form.tsx`. These two forms show success via `{
      state.success && <p className="text-sm text-emerald-500">{dict.saved}</p> }`, the
      only place in the app that signals success with inline colored text instead of a
      `sonner` toast (25+ other call sites use `toast.success(...)` — see
      `src/components/household/invite-button.tsx:51` or
      `src/components/inventory/inventory-table.tsx:163` for the reference pattern). Change
      both forms to call `toast.success(dict.saved)` (or the equivalent existing dict key)
      from the `useActionState`/`useEffect` completion path instead of rendering the inline
      `<p>`, matching how other `useActionState`-driven forms in this repo surface success
      (check `src/components/inventory/add-item-dialog.tsx` or another dialog-based form
      already wired through `useActionState` + toast for the exact pattern to mirror). Keep
      the existing inline error-text handling for `state.error` unchanged — only success
      feedback moves to a toast. Verify with `npm run lint`, `npx tsc --noEmit`, `npm run
      test`, and a manual check that saving a display-name or email change now shows a
      toast instead of inline green text.

## Wave 2 — sequential (both touch the create-flow UX for the same two features)

Run one at a time, each rebased on the previous one's merge, since both change
`AddTaskForm`/`AddItemForm`'s on-page presence and a mid-air merge would be hard to reason
about.

- [ ] **F. Give Tasks a "+"-button-triggered create dialog, matching Inventory/Recipes** —
      `src/components/tasks/tasks-client.tsx`. Tasks currently has no "+" affordance at
      all — `AddTaskForm` (line 44) is permanently rendered above the task list (mounted at
      line 157), unlike Inventory (`src/app/dashboard/inventory/page.tsx:96-109`) and
      Recipes (`src/components/meal-planning/recipe-manager.tsx:51-63`), which both use a
      `<Plus>` icon button that opens a modal `Dialog`. Convert task creation to the same
      pattern: wrap `AddTaskForm`'s fields in a `Dialog` triggered by a `<Plus>` button
      placed where Inventory/Recipes place theirs (top-right of the list/section header),
      reusing the existing `EditTaskDialog` (`src/components/tasks/edit-task-dialog.tsx`)
      as a structural reference for the dialog shell since it's already built for this
      entity. Do not change `AddTaskForm`'s underlying field set, validation, or server
      action — only its presentation (always-inline → behind a "+" dialog trigger). Keep
      the task list's own empty state as the dashed-box pattern (Wave 1 item C's reference
      style) since removing the permanently-visible form means empty-state discoverability
      now matters more — consider whether the empty state's copy should mention the "+"
      button (make a reasonable call, don't block on it). Verify with `npm run lint`, `npx
      tsc --noEmit`, `npm run test`, and a manual check that creating a task now goes
      through a "+" button and modal, matching Inventory's interaction.

- [ ] **G. Give shopping-list items the same "+"-button-triggered create dialog** —
      `src/components/shopping/shopping-list-client.tsx`. Same change as item F, applied to
      `AddItemForm` (currently rendered unconditionally at lines 338-346, form itself at
      lines 118-133). Convert it to a `<Plus>`-button-triggered `Dialog`, using
      `EditShoppingItemDialog` (`src/components/shopping/edit-shopping-item-dialog.tsx`) as
      the structural reference for the dialog shell, matching the same interaction now
      used by Tasks (item F) and Inventory/Recipes. Do not change the underlying field set,
      validation, or server action. This task depends on F only in that it should follow
      the same interaction shape decided there (button placement, dialog sizing) for
      cross-feature consistency — rebase on F's merge before starting so both features end
      up visually identical, not just conceptually similar. Verify with `npm run lint`,
      `npx tsc --noEmit`, `npm run test`, and a manual check that adding a shopping-list
      item now goes through a "+" button and modal, matching Tasks and Inventory.

## Wave 3 — independent of Waves 1-2, isolated due to size/risk (own PR, needs a product
## decision before implementation)

- [ ] **H. Unify Create/Edit into one form component per entity, for Tasks and Shopping
      Items** — `src/components/tasks/` (`AddTaskForm` vs. `EditTaskDialog`) and
      `src/components/shopping/` (`AddItemForm` vs. `EditShoppingItemDialog`). Unlike
      Inventory (`ItemFormDialog` with a `mode="create"|"edit"` prop —
      `src/components/inventory/add-item-dialog.tsx:25,37,80`) and Recipes
      (`RecipeFormDialog`, same pattern), Tasks and Shopping Items each have two
      independently written form components for the same entity — the comment at
      `src/components/tasks/edit-task-dialog.tsx:1-6` explicitly says it "mirrors
      EditShoppingItemDialog's shape" rather than sharing code with its own create form.
      This means a field added to one doesn't propagate to the other. After Wave 2 lands
      (both creates are now dialog-based, making the merge mechanical rather than also a
      layout change), merge each pair into one component taking a `mode="create"|"edit"`
      prop, following `ItemFormDialog`'s exact shape as the reference implementation.
      Preserve all existing field validation, copy, and server actions — this is a
      structural merge, not a redesign. Do this as two separate PRs (Tasks, then Shopping
      Items) rather than one, since they touch unrelated files and a reviewer should be
      able to evaluate each merge independently. Verify each with `npm run lint`, `npx tsc
      --noEmit`, `npm run test`, `npm run build`, and a manual check that both create and
      edit still work correctly for the entity, field-for-field.

- [ ] **I. Decide and document a single "how do households add members" pattern, or
      explicitly scope invite-links as the intentional exception** — no code change until
      this is decided; this is a product decision, not a bug. Every other feature's create
      flow is "+" button → form (Wave 2 makes this universal for Tasks/Shopping too);
      Household membership instead only changes via `InviteButton`
      (`src/components/household/invite-button.tsx:19-40`), a shareable-link flow with no
      equivalent anywhere else in the app. This may well be the *correct* UX for household
      membership (you can't "create" another person the way you create an inventory item),
      but it should be a documented decision rather than an unexamined outlier — add a
      short note to this file's own history (or wherever this repo tracks product
      decisions) confirming invite-link is intentional, or, if not, scope a follow-up task
      here once decided. Do not implement anything else under this item without that
      decision being made first.

- [ ] **J. Evaluate collapsing Personal Budget into parameterized Budget** — `src/
      components/personal-budget/` currently duplicates `src/components/budget/`'s entire
      component tree (`personal-transaction-dialog.tsx` vs. `transaction-dialog.tsx`,
      `personal-category-manager.tsx` vs. `category-manager.tsx`,
      `personal-budget-tabs.tsx`, `personal-recurring-template-dialog.tsx`,
      `personal-due-recurring-widget.tsx` with no shared equivalents) rather than
      parameterizing one implementation by scope (household vs. personal). This is the
      root cause that lets every fix in this backlog need to be applied twice to stay
      fixed — e.g. Wave 1 items B/C/D/E each have a Personal Budget equivalent that will
      independently drift unless applied there too. This item is scoped as a design spike,
      not an implementation task: produce a short plan (as a new file,
      `PERSONAL_BUDGET_UNIFICATION.md`, following this repo's existing planning-doc style)
      proposing how to parameterize the two trees into one (e.g. a `scope: "household" |
      "personal"` prop threaded through the shared components, or a shared base component
      with two thin wrappers), enumerating every file pair that would need to merge, and
      flagging any behavioral differences between the two trees found along the way (don't
      assume they're behaviorally identical today — check). Do not implement the merge in
      this task; hand the resulting plan back for a human decision on wave/effort before
      scoping the actual implementation tasks.

## Notes for any agent resuming a task after an interruption

Follow `PRODUCTION_READINESS.md`'s own convention: each task's worktree should get its
own `AGENT_PROGRESS.md` at its root reflecting true current progress and next steps, for
anyone (human or agent) resuming after an interruption.
