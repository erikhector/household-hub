-- CreateTable
CREATE TABLE "ShoppingListTemplate" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShoppingListTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingListTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShoppingListTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingListTemplate_householdId_idx" ON "ShoppingListTemplate"("householdId");

-- CreateIndex
CREATE INDEX "ShoppingListTemplateItem_templateId_idx" ON "ShoppingListTemplateItem"("templateId");

-- AddForeignKey
ALTER TABLE "ShoppingListTemplate" ADD CONSTRAINT "ShoppingListTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListTemplateItem" ADD CONSTRAINT "ShoppingListTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShoppingListTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
