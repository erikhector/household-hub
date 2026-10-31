-- CreateTable
CREATE TABLE "MealPlanTemplate" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealPlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealPlanTemplateEntry" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "mealType" "MealType" NOT NULL,
    "recipeId" TEXT,
    "freeformName" TEXT,
    "portions" INTEGER NOT NULL DEFAULT 4,

    CONSTRAINT "MealPlanTemplateEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MealPlanTemplate_householdId_name_key" ON "MealPlanTemplate"("householdId", "name");

-- CreateIndex
CREATE INDEX "MealPlanTemplateEntry_templateId_idx" ON "MealPlanTemplateEntry"("templateId");

-- CreateIndex
CREATE INDEX "MealPlanTemplateEntry_recipeId_idx" ON "MealPlanTemplateEntry"("recipeId");

-- AddForeignKey
ALTER TABLE "MealPlanTemplate" ADD CONSTRAINT "MealPlanTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanTemplateEntry" ADD CONSTRAINT "MealPlanTemplateEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MealPlanTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealPlanTemplateEntry" ADD CONSTRAINT "MealPlanTemplateEntry_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
