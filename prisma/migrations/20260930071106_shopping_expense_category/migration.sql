-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "shoppingExpenseCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_shoppingExpenseCategoryId_fkey" FOREIGN KEY ("shoppingExpenseCategoryId") REFERENCES "BudgetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
