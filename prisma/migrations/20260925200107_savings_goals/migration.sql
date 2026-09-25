-- AlterTable
ALTER TABLE "BudgetCategory" ADD COLUMN     "goalAmount" DOUBLE PRECISION,
ADD COLUMN     "goalDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PersonalBudgetCategory" ADD COLUMN     "goalAmount" DOUBLE PRECISION,
ADD COLUMN     "goalDate" TIMESTAMP(3);
