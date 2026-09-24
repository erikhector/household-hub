-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_householdId_barcode_key" ON "InventoryItem"("householdId", "barcode");

