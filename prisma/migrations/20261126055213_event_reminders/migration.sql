-- CreateEnum
CREATE TYPE "EventReminder" AS ENUM ('MORNING_OF', 'DAY_BEFORE');

-- AlterTable
ALTER TABLE "HouseholdEvent" ADD COLUMN     "reminder" "EventReminder";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "eventReminderNudge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventReminderSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventReminderSend_eventId_idx" ON "EventReminderSend"("eventId");

-- CreateIndex
CREATE INDEX "EventReminderSend_occurrenceDate_idx" ON "EventReminderSend"("occurrenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "EventReminderSend_userId_eventId_occurrenceDate_key" ON "EventReminderSend"("userId", "eventId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HouseholdEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
