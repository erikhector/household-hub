-- UX-102: remember the completion a tick overwrote so un-ticking restores it.
ALTER TABLE "HouseholdTask" ADD COLUMN "previousCompletedAt" TIMESTAMP(3),
ADD COLUMN "previousCompletedByMemberId" TEXT;
