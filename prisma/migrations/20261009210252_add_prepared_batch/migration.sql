-- DropForeignKey
ALTER TABLE "MealPlanEntry" DROP CONSTRAINT "MealPlanEntry_preparedBatch_fkey";

-- DropForeignKey
ALTER TABLE "PreparedBatch" DROP CONSTRAINT "PreparedBatch_household_fkey";

-- DropForeignKey
ALTER TABLE "PreparedBatch" DROP CONSTRAINT "PreparedBatch_recipe_fkey";

-- DropIndex
DROP INDEX "MealPlanEntry_preparedBatch_idx";

-- AddForeignKey
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PreparedBatch_household_idx" RENAME TO "PreparedBatch_householdId_idx";
