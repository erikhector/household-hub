# Meal planning UI — progress

Branch: `feature/meal-planning`

## Checklist

- [x] Read AGENTS.md, REQUIREMENTS.md, AGENT_TASKS.md (ground rules + task 1)
- [x] Explored existing shopping-list feature as the reference pattern
      (`src/app/dashboard/shopping-list/actions.ts`,
      `src/components/shopping/*`), UI primitives, dictionary structure
- [ ] `src/app/dashboard/meal-planning/meal-types.ts` — shared constants/types
      (MEAL_TYPES, CUSTOM_RECIPE_SENTINEL) — kept out of actions.ts because a
      `"use server"` file may only export async functions
- [ ] `src/app/dashboard/meal-planning/date-utils.ts` — week/date helpers
      (Monday-start week, UTC date-key math), no "use server"
- [ ] `src/app/dashboard/meal-planning/actions.ts` — Server Actions:
      createRecipeAction, updateRecipeAction, deleteRecipeAction,
      addMealEntryAction, deleteMealEntryAction, local
      `findOrCreateInventoryItem` copied from shopping-list/actions.ts pattern
- [ ] `src/app/dashboard/meal-planning/page.tsx` — Server Component: fetches
      recipes + current-week MealPlan (via `?week=yyyy-mm-dd` search param),
      passes to client view
- [ ] `src/components/meal-planning/meal-planning-view.tsx` — client tab
      wrapper (Planner / Recipes)
- [ ] `src/components/meal-planning/week-planner.tsx` — weekly grid, week
      nav, add/delete meal entries
- [ ] `src/components/meal-planning/add-meal-dialog.tsx` — dialog to assign a
      recipe or freeform meal name to a date+mealType slot
- [ ] `src/components/meal-planning/recipe-manager.tsx` — recipe list +
      delete
- [ ] `src/components/meal-planning/recipe-form-dialog.tsx` — create/edit
      recipe dialog with dynamic ingredient rows
- [ ] i18n: `mealPlanning` namespace in both `src/lib/i18n/dictionaries/en.ts`
      and `sv.ts` (real Swedish translations, not copied English)
- [ ] REQUIREMENTS.md: new subsection under "Data model" documenting the
      meal-planning feature; remove "Meal planning UI" from "Not yet built"
- [ ] `npx tsc --noEmit -p tsconfig.json` — zero errors
- [ ] `npx eslint src` — zero errors/warnings
- [ ] `npm run build` — succeeds
- [ ] Final commit with this file fully checked off

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
