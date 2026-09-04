# Meal planning UI — progress

Branch: `feature/meal-planning`

## Checklist

- [x] Read AGENTS.md, REQUIREMENTS.md, AGENT_TASKS.md (ground rules + task 1)
- [x] Explored existing shopping-list feature as the reference pattern
      (`src/app/dashboard/shopping-list/actions.ts`,
      `src/components/shopping/*`), UI primitives, dictionary structure
- [x] `src/app/dashboard/meal-planning/meal-types.ts` — shared constants/types
      (MEAL_TYPES, CUSTOM_RECIPE_SENTINEL) — kept out of actions.ts because a
      `"use server"` file may only export async functions
- [x] `src/app/dashboard/meal-planning/date-utils.ts` — week/date helpers
      (Monday-start week, UTC date-key math), no "use server"
- [x] `src/app/dashboard/meal-planning/actions.ts` — Server Actions:
      createRecipeAction, updateRecipeAction, deleteRecipeAction,
      addMealEntryAction, deleteMealEntryAction, local
      `findOrCreateInventoryItem` copied from shopping-list/actions.ts pattern
- [x] `src/app/dashboard/meal-planning/page.tsx` — Server Component: fetches
      recipes + current-week MealPlan (via `?week=yyyy-mm-dd` search param),
      passes to client view
- [x] `src/components/meal-planning/meal-planning-view.tsx` — client tab
      wrapper (Planner / Recipes)
- [x] `src/components/meal-planning/week-planner.tsx` — weekly grid, week
      nav, add/delete meal entries
- [x] `src/components/meal-planning/add-meal-dialog.tsx` — dialog to assign a
      recipe or freeform meal name to a date+mealType slot
- [x] `src/components/meal-planning/recipe-manager.tsx` — recipe list +
      delete
- [x] `src/components/meal-planning/recipe-form-dialog.tsx` — create/edit
      recipe dialog with dynamic ingredient rows
- [x] i18n: `mealPlanning` namespace in both `src/lib/i18n/dictionaries/en.ts`
      and `sv.ts` (real Swedish translations, not copied English)
- [x] REQUIREMENTS.md: new "## Meal planning" subsection added, "Meal
      planning UI" removed from "Not yet built", the existing "Meal
      planning" line under "Data model" updated from "(schema only, no UI
      yet)" to "(built — see...)"
- [x] `npx tsc --noEmit -p tsconfig.json` — zero errors (ran `npx next
      typegen` first so the global `PageProps`/`LayoutProps` helpers exist —
      needed once per fresh worktree, `next build`/`next dev` also generate
      them)
- [x] `npx eslint src` — zero errors/warnings
- [x] `npm run build` — succeeds
- [x] Final commit with this file fully checked off

## Decisions

- No Prisma migration needed — schema already has Recipe/RecipeIngredient/
  MealPlan/MealPlanEntry.
- `findOrCreateInventoryItem` is duplicated locally in
  `meal-planning/actions.ts` (not imported from shopping-list's actions.ts)
  — matches the task instruction to replicate the pattern, and avoids
  cross-feature coupling between two independently-owned worktrees.
- Meal entries support create + delete only (no in-place edit) — consistent
  with the app's existing simplicity elsewhere (shopping list items are also
  add/toggle/delete, no edit). Editing a wrong entry means deleting it and
  adding a new one.
- Weekly planner uses Monday-start weeks, `weekStartDate`/entry `date`
  stored as UTC midnight, addressed via a `?week=yyyy-mm-dd` search param
  (default: Monday of the current week). `MealPlan` rows are created lazily
  (upsert) the first time a meal is added to a given week, not on page view.
- Weekday header labels come from the dictionary (not `Intl`/browser locale)
  so they follow the app's own language toggle rather than the browser's
  locale, unlike the pre-existing `toLocaleDateString()` used for the
  shopping list's default name (kept that minor precedent as-is, not part of
  this task's scope).
- Added `src/components/ui/textarea.tsx` (recipe instructions field) — no
  existing primitive fit, matches the ground rule "add a new one only if
  nothing fits, put it in `src/components/ui/`". Styled to match `Input`.
- Could not run a live browser smoke test: this worktree's `next dev` shares
  a machine-wide single-dev-server lock with the main repo checkout (Next
  16 behavior — see `.next/dev/logs` message "Another next dev server is
  already running... PID: <the main repo's dev server>"). Killing that PID
  would affect the user's/another agent's own session, which is out of
  scope to do unilaterally, so verification relied on `tsc`/`eslint`/`build`
  passing cleanly plus careful manual review instead.
- Copied `.env` from the main repo root into this worktree (gitignored, not
  committed) purely to attempt the dev-server smoke test above.
- No files outside the task's "Primary files" / "Shared files" scope were
  touched — `nav-items.ts` already had the "Meal planning" entry from an
  earlier commit, so it needed no changes (per the task brief's expectation).
