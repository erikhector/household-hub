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
