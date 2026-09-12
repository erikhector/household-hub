-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'EXPIRING_SOON';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "expiresAt" TIMESTAMP(3);
