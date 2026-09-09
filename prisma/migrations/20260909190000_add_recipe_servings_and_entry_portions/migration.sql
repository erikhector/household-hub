-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "servings" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "MealPlanEntry" ADD COLUMN     "portions" INTEGER NOT NULL DEFAULT 4;
