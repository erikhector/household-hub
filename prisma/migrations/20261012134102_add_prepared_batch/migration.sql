-- AlterTable
ALTER TABLE "MealPlanEntry" ADD COLUMN     "preparedBatchId" TEXT,
ADD COLUMN     "preparedPortionsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PreparedBatch" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "cookedByMemberId" TEXT,
    "totalPortions" INTEGER NOT NULL,
    "remainingPortions" INTEGER NOT NULL,
    "cookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreparedBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreparedBatch_householdId_idx" ON "PreparedBatch"("householdId");

-- CreateIndex
CREATE INDEX "PreparedBatch_recipeId_idx" ON "PreparedBatch"("recipeId");

-- CreateIndex
CREATE INDEX "PreparedBatch_cookedByMemberId_idx" ON "PreparedBatch"("cookedByMemberId");

-- CreateIndex
CREATE INDEX "MealPlanEntry_preparedBatchId_idx" ON "MealPlanEntry"("preparedBatchId");

-- AddForeignKey
ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_preparedBatchId_fkey" FOREIGN KEY ("preparedBatchId") REFERENCES "PreparedBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparedBatch" ADD CONSTRAINT "PreparedBatch_cookedByMemberId_fkey" FOREIGN KEY ("cookedByMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
