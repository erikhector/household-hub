-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_DUE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "taskDueDate" DATE,
ADD COLUMN     "taskLines" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "taskDueNudge" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_householdId_taskDueDate_key" ON "Notification"("householdId", "taskDueDate");

