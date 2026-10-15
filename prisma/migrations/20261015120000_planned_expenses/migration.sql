-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "plannedExpenseId" TEXT;

-- CreateTable
CREATE TABLE "PlannedExpense" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedExpenseSplit" (
    "id" TEXT NOT NULL,
    "plannedExpenseId" TEXT NOT NULL,
    "householdMemberId" TEXT NOT NULL,
    "amountOwed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannedExpenseSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannedExpense_householdId_dueDate_idx" ON "PlannedExpense"("householdId", "dueDate");

-- CreateIndex
CREATE INDEX "PlannedExpense_categoryId_idx" ON "PlannedExpense"("categoryId");

-- CreateIndex
CREATE INDEX "PlannedExpenseSplit_plannedExpenseId_idx" ON "PlannedExpenseSplit"("plannedExpenseId");

-- CreateIndex
CREATE INDEX "PlannedExpenseSplit_householdMemberId_idx" ON "PlannedExpenseSplit"("householdMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedExpenseSplit_plannedExpenseId_householdMemberId_key" ON "PlannedExpenseSplit"("plannedExpenseId", "householdMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plannedExpenseId_key" ON "Transaction"("plannedExpenseId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_plannedExpenseId_fkey" FOREIGN KEY ("plannedExpenseId") REFERENCES "PlannedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpenseSplit" ADD CONSTRAINT "PlannedExpenseSplit_plannedExpenseId_fkey" FOREIGN KEY ("plannedExpenseId") REFERENCES "PlannedExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpenseSplit" ADD CONSTRAINT "PlannedExpenseSplit_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

