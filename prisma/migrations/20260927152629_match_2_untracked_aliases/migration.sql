-- AlterTable
ALTER TABLE "RecipeIngredient" ADD COLUMN     "note" TEXT,
ADD COLUMN     "rawText" TEXT,
ADD COLUMN     "untracked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ItemAlias" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemAlias_inventoryItemId_idx" ON "ItemAlias"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemAlias_householdId_normalizedName_key" ON "ItemAlias"("householdId", "normalizedName");

-- AddForeignKey
ALTER TABLE "ItemAlias" ADD CONSTRAINT "ItemAlias_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemAlias" ADD CONSTRAINT "ItemAlias_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
