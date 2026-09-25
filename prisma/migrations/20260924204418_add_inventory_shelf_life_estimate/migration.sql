-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "expiresAtEstimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shelfLifeDays" INTEGER;
