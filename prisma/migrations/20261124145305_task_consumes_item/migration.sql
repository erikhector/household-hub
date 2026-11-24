-- AlterTable
ALTER TABLE "HouseholdTask" ADD COLUMN     "consumesItemId" TEXT,
ADD COLUMN     "consumesQuantity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "InventoryItemEvent" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "HouseholdTask_consumesItemId_idx" ON "HouseholdTask"("consumesItemId");

-- CreateIndex
CREATE INDEX "InventoryItemEvent_taskId_idx" ON "InventoryItemEvent"("taskId");

-- AddForeignKey
ALTER TABLE "InventoryItemEvent" ADD CONSTRAINT "InventoryItemEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HouseholdTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdTask" ADD CONSTRAINT "HouseholdTask_consumesItemId_fkey" FOREIGN KEY ("consumesItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
