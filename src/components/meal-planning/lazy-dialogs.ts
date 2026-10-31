import { createLazyDialogLoader } from "@/components/ui/lazy-dialog";

// PERF-26: the meal planning page's dialogs, loaded on first use with the
// lazy-dialog helper (components/ui/lazy-dialog.tsx). One loader per dialog,
// shared by the host that mounts it and any opener that wants to warm its
// chunk. Kept in one module so the import() paths are in a single place and
// out of the page's own chunk.

export const loadMealEntryDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/meal-entry-dialog").then((m) => m.MealEntryDialog),
);
export const loadCookModeDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/cook-mode-dialog").then((m) => m.CookModeDialog),
);
export const loadMarkCookedDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/mark-cooked-dialog").then((m) => m.MarkCookedDialog),
);
export const loadMoveMealDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/move-meal-dialog").then((m) => m.MoveMealDialog),
);
export const loadFillEmptyDaysDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/fill-empty-days-dialog").then((m) => m.FillEmptyDaysDialog),
);
export const loadMissingIngredientsDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/missing-ingredients-dialog").then((m) => m.MissingIngredientsDialog),
);
export const loadAddToPlanDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/add-to-plan-dialog").then((m) => m.AddToPlanDialog),
);
export const loadRecipeFormDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/recipe-form-dialog").then((m) => m.RecipeFormDialog),
);
export const loadRecipeFileImportDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/recipe-file-import-dialog").then((m) => m.RecipeFileImportDialog),
);
export const loadRecordPrepDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/record-prep-dialog").then((m) => m.RecordPrepDialog),
);
export const loadPlanPortionsDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/plan-portions-dialog").then((m) => m.PlanPortionsDialog),
);
export const loadSaveWeekTemplateDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/plan-template-dialogs").then((m) => m.SaveWeekTemplateDialog),
);
export const loadPlanFromTemplateDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/plan-template-dialogs").then((m) => m.PlanFromTemplateDialog),
);
// Week picks' three sheets: the picker, a pick's place sheet and Spread.
export const loadPickMealsDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/pick-meals-dialog").then((m) => m.PickMealsDialog),
);
export const loadPlacePickDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/place-pick-dialog").then((m) => m.PlacePickDialog),
);
export const loadSpreadPicksDialog = createLazyDialogLoader(() =>
  import("@/components/meal-planning/spread-picks-dialog").then((m) => m.SpreadPicksDialog),
);
