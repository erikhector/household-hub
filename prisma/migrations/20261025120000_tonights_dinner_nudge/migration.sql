-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'TONIGHTS_DINNER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tonightsDinnerNudge" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "mealNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tonightsDinnerDate" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_householdId_tonightsDinnerDate_key" ON "Notification"("householdId", "tonightsDinnerDate");
