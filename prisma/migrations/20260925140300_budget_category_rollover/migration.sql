-- AlterTable
ALTER TABLE "BudgetCategory" ADD COLUMN     "rolloverEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PersonalBudgetCategory" ADD COLUMN     "rolloverEnabled" BOOLEAN NOT NULL DEFAULT false;

