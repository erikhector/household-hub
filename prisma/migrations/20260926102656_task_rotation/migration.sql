-- AlterTable
ALTER TABLE "HouseholdTask" ADD COLUMN     "rotationMemberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rotationPreviousAssigneeId" TEXT;

