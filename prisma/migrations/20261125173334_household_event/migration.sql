-- CreateTable
CREATE TABLE "HouseholdEvent" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "notes" TEXT,
    "forMemberId" TEXT,
    "createdByMemberId" TEXT,
    "recurrence" "RecurrenceFrequency",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdEvent_householdId_idx" ON "HouseholdEvent"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdEvent_forMemberId_idx" ON "HouseholdEvent"("forMemberId");

-- CreateIndex
CREATE INDEX "HouseholdEvent_createdByMemberId_idx" ON "HouseholdEvent"("createdByMemberId");

-- AddForeignKey
ALTER TABLE "HouseholdEvent" ADD CONSTRAINT "HouseholdEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdEvent" ADD CONSTRAINT "HouseholdEvent_forMemberId_fkey" FOREIGN KEY ("forMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdEvent" ADD CONSTRAINT "HouseholdEvent_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
