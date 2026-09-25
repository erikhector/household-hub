-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'PRICE_SPIKE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "priceIncreasePercent" INTEGER;

-- AlterTable
ALTER TABLE "PriceHistory" ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "unit" TEXT;
