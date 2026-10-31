-- CreateTable
CREATE TABLE "MealPlanPick" (
    "id" TEXT NOT NULL,
    "mealPlanId" TEXT NOT NULL,
    "recipeId" TEXT,
    "freeformName" TEXT,
    "portions" INTEGER NOT NULL DEFAULT 4,
    "carriedFromWeek" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealPlanPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MealPlanPick_mealPlanId_idx" ON "MealPlanPick"("mealPlanId");

-- CreateIndex
CREATE INDEX "MealPlanPick_recipeId_idx" ON "MealPlanPick"("recipeId");

-- AddForeignKey
ALTER TABLE "MealPlanPick" ADD CONSTRAINT "MealPlanPick_mealPlanId_fkey" FOREIGN KEY ("mealPlanId") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanPick" ADD CONSTRAINT "MealPlanPick_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
