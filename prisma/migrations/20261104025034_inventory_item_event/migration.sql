-- CreateTable
CREATE TABLE "InventoryItemEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItemEvent_itemId_createdAt_idx" ON "InventoryItemEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemEvent_householdId_idx" ON "InventoryItemEvent"("householdId");

-- AddForeignKey
ALTER TABLE "InventoryItemEvent" ADD CONSTRAINT "InventoryItemEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
