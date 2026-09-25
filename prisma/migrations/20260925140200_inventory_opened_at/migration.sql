-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "useWithinDaysOpened" INTEGER;

