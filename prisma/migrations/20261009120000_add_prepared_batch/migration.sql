-- Add PreparedBatch model and link MealPlanEntry to it.

-- Create table
CREATE TABLE "PreparedBatch" (
  "id" TEXT PRIMARY KEY,
  "householdId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "cookedByMemberId" TEXT,
  "totalPortions" INTEGER NOT NULL,
  "remainingPortions" INTEGER NOT NULL,
  "cookedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiryDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_household_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE;
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_recipe_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT;

CREATE INDEX "PreparedBatch_household_idx" ON "PreparedBatch" ("householdId");

-- Alter MealPlanEntry to add prepared fields
ALTER TABLE "MealPlanEntry" ADD COLUMN "preparedBatchId" TEXT;
ALTER TABLE "MealPlanEntry" ADD COLUMN "preparedPortionsUsed" INTEGER DEFAULT 0;
ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_preparedBatch_fkey" FOREIGN KEY ("preparedBatchId") REFERENCES "PreparedBatch"("id") ON DELETE SET NULL;
CREATE INDEX "MealPlanEntry_preparedBatch_idx" ON "MealPlanEntry" ("preparedBatchId");
