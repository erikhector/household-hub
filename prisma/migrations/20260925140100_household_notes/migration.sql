-- CreateTable
CREATE TABLE "HouseholdNote" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "authorMemberId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseholdNote_householdId_idx" ON "HouseholdNote"("householdId");

-- AddForeignKey
ALTER TABLE "HouseholdNote" ADD CONSTRAINT "HouseholdNote_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdNote" ADD CONSTRAINT "HouseholdNote_authorMemberId_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

