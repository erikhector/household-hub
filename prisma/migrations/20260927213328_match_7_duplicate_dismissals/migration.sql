-- CreateTable
CREATE TABLE "InventoryDuplicateDismissal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemAId" TEXT NOT NULL,
    "itemBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryDuplicateDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryDuplicateDismissal_itemAId_idx" ON "InventoryDuplicateDismissal"("itemAId");

-- CreateIndex
CREATE INDEX "InventoryDuplicateDismissal_itemBId_idx" ON "InventoryDuplicateDismissal"("itemBId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryDuplicateDismissal_householdId_itemAId_itemBId_key" ON "InventoryDuplicateDismissal"("householdId", "itemAId", "itemBId");

-- AddForeignKey
ALTER TABLE "InventoryDuplicateDismissal" ADD CONSTRAINT "InventoryDuplicateDismissal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDuplicateDismissal" ADD CONSTRAINT "InventoryDuplicateDismissal_itemAId_fkey" FOREIGN KEY ("itemAId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryDuplicateDismissal" ADD CONSTRAINT "InventoryDuplicateDismissal_itemBId_fkey" FOREIGN KEY ("itemBId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
