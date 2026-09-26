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
    "inventoryItemId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShoppingListTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingListTemplate_householdId_name_key" ON "ShoppingListTemplate"("householdId", "name");

-- CreateIndex
CREATE INDEX "ShoppingListTemplateItem_templateId_idx" ON "ShoppingListTemplateItem"("templateId");

-- CreateIndex
CREATE INDEX "ShoppingListTemplateItem_inventoryItemId_idx" ON "ShoppingListTemplateItem"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "ShoppingListTemplate" ADD CONSTRAINT "ShoppingListTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListTemplateItem" ADD CONSTRAINT "ShoppingListTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ShoppingListTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListTemplateItem" ADD CONSTRAINT "ShoppingListTemplateItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
