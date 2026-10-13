-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "frozenAt" TIMESTAMP(3),
ADD COLUMN     "useWithinDaysFrozen" INTEGER;
