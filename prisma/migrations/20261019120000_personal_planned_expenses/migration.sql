-- AlterTable
ALTER TABLE "PersonalTransaction" ADD COLUMN     "plannedExpenseId" TEXT;

-- CreateTable
CREATE TABLE "PersonalPlannedExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalPlannedExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalPlannedExpense_userId_dueDate_idx" ON "PersonalPlannedExpense"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "PersonalPlannedExpense_categoryId_idx" ON "PersonalPlannedExpense"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalTransaction_plannedExpenseId_key" ON "PersonalTransaction"("plannedExpenseId");

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_plannedExpenseId_fkey" FOREIGN KEY ("plannedExpenseId") REFERENCES "PersonalPlannedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPlannedExpense" ADD CONSTRAINT "PersonalPlannedExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalPlannedExpense" ADD CONSTRAINT "PersonalPlannedExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PersonalBudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

