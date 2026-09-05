import type { MealType } from "@/app/dashboard/meal-planning/meal-types";

export type RecipeIngredientData = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
};

export type RecipeData = {
  id: string;
  name: string;
  instructions: string | null;
  ingredients: RecipeIngredientData[];
};

export type MealPlanEntryData = {
  id: string;
  date: string; // yyyy-mm-dd
  mealType: MealType;
  recipeId: string | null;
  recipeName: string | null;
  freeformName: string | null;
};

// One ingredient the planned week's recipes need more of than the household
// currently has on hand — see previewMissingIngredientsAction.
export type MissingIngredientData = {
  key: string;
  name: string;
  unit: string;
  missingQuantity: number;
};

// An ACTIVE shopping list the "add missing ingredients" dialog can add to.
export type ActiveShoppingListOption = {
  id: string;
  name: string;
};
