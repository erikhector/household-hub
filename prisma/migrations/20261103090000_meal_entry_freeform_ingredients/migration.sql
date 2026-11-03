-- GAP-58: optional ingredient lines on a custom meal.
ALTER TABLE "MealPlanEntry" ADD COLUMN "freeformIngredients" TEXT;
