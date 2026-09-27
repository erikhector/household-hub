-- CreateTable
CREATE TABLE "ItemUnitConversion" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "fromUnit" TEXT NOT NULL,
    "factor" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemUnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnitConversion_inventoryItemId_fromUnit_key" ON "ItemUnitConversion"("inventoryItemId", "fromUnit");

-- AddForeignKey
ALTER TABLE "ItemUnitConversion" ADD CONSTRAINT "ItemUnitConversion_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
