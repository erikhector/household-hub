-- CreateTable
CREATE TABLE "RecipeComponent" (
    "id" TEXT NOT NULL,
    "parentRecipeId" TEXT NOT NULL,
    "componentRecipeId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "RecipeComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipeComponent_parentRecipeId_idx" ON "RecipeComponent"("parentRecipeId");

-- CreateIndex
CREATE INDEX "RecipeComponent_componentRecipeId_idx" ON "RecipeComponent"("componentRecipeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeComponent_parentRecipeId_componentRecipeId_key" ON "RecipeComponent"("parentRecipeId", "componentRecipeId");

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_parentRecipeId_fkey" FOREIGN KEY ("parentRecipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeComponent" ADD CONSTRAINT "RecipeComponent_componentRecipeId_fkey" FOREIGN KEY ("componentRecipeId") REFERENCES "Recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
