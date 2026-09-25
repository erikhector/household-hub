-- AlterTable
ALTER TABLE "User" ADD COLUMN     "weeklyDigestEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WeeklyDigestSend" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyDigestSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyDigestSend_householdId_idx" ON "WeeklyDigestSend"("householdId");

-- CreateIndex
CREATE INDEX "WeeklyDigestSend_sentAt_idx" ON "WeeklyDigestSend"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDigestSend_userId_householdId_weekKey_key" ON "WeeklyDigestSend"("userId", "householdId", "weekKey");

-- AddForeignKey
ALTER TABLE "WeeklyDigestSend" ADD CONSTRAINT "WeeklyDigestSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDigestSend" ADD CONSTRAINT "WeeklyDigestSend_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
