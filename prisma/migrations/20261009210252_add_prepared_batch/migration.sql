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

-- Re-add MealPlanEntry foreign key and index (preserve referential integrity)
ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_preparedBatchId_fkey" FOREIGN KEY ("preparedBatchId") REFERENCES "PreparedBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "MealPlanEntry_preparedBatchId_idx" ON "MealPlanEntry" ("preparedBatchId");
