// Shared constants/types for the meal-planning feature. Kept separate from
// actions.ts because a "use server" file may only export async functions —
// these plain values need to be importable from both Server and Client
// Components.

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

// Sentinel used in the "assign a meal" <Select> to mean "type a freeform
// meal name instead of picking a recipe" — mirrors the `"__all__"` sentinel
// pattern already used for InventoryClient's filter selects (see
// REQUIREMENTS.md's Conventions section).
export const CUSTOM_RECIPE_SENTINEL = "__custom__";

// Same sentinel pattern, used in the "add missing ingredients" dialog's
// target-list <Select> to mean "create a new shopping list" instead of
// picking an existing active one.
export const NEW_SHOPPING_LIST_SENTINEL = "__new_list__";

// GAP-59: the meal-plan search waits for this many characters, in the field
// (to know when to ask) and the loader (to refuse), since a one-letter query
// matches half the plan.
export const MEAL_SEARCH_MIN_CHARS = 2;
