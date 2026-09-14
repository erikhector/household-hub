-- CreateTable
CREATE TABLE "HouseholdTask" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignedToMemberId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdTask_householdId_idx" ON "HouseholdTask"("householdId");

-- CreateIndex
CREATE INDEX "HouseholdTask_assignedToMemberId_idx" ON "HouseholdTask"("assignedToMemberId");

-- AddForeignKey
ALTER TABLE "HouseholdTask" ADD CONSTRAINT "HouseholdTask_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdTask" ADD CONSTRAINT "HouseholdTask_assignedToMemberId_fkey" FOREIGN KEY ("assignedToMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdTask" ADD CONSTRAINT "HouseholdTask_completedByMemberId_fkey" FOREIGN KEY ("completedByMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
