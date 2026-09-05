-- Household contribution/expense splitting (opt-in per transaction — see
-- REQUIREMENTS.md's "Household expense splitting" subsection under
-- Budgeting). A Transaction can optionally record who paid
-- (paidByMemberId) and, via TransactionSplit, how its cost is divided
-- among household members. Both are nullable/absent by default, so an
-- existing (unsplit) transaction is completely unaffected.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "paidByMemberId" TEXT;

-- AddForeignKey
-- SetNull: a transaction must survive its payer later leaving the
-- household, it just loses the "paid by" note (mirrors
-- RecipeIngredient.inventoryItemId's onDelete: SetNull).
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paidByMemberId_fkey" FOREIGN KEY ("paidByMemberId") REFERENCES "HouseholdMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "householdMemberId" TEXT NOT NULL,
    "amountOwed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransactionSplit_transactionId_idx" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_householdMemberId_idx" ON "TransactionSplit"("householdMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSplit_transactionId_householdMemberId_key" ON "TransactionSplit"("transactionId", "householdMemberId");

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: an ex-member's own split rows are simply removed with them — a
-- known simplification for an edge case out of scope for this task.
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
