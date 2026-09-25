-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "quietHoursEnd" INTEGER,
ADD COLUMN     "quietHoursStart" INTEGER,
ADD COLUMN     "timeZone" TEXT;

