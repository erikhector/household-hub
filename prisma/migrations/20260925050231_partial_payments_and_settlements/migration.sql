-- Partial payments on split transactions + member-to-member settlements.
-- See REQUIREMENTS.md's "Household expense splitting" subsection.
--
-- Transaction.paidByMemberId (one payer for the whole bill) is replaced by a
-- per-member TransactionSplit.amountPaid, so a bill can be paid partly by
-- several members. The old column is backfilled into the new one *before*
-- it's dropped, so no "who paid" information is lost.

-- AlterTable
ALTER TABLE "TransactionSplit" ADD COLUMN     "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill 1: the recorded payer paid the whole bill.
UPDATE "TransactionSplit" s
SET "amountPaid" = t."amount"
FROM "Transaction" t
WHERE s."transactionId" = t."id"
  AND s."householdMemberId" = t."paidByMemberId";

-- Backfill 2: a payer who wasn't part of the split (a 0-share payer) gets a
-- zero-share row to carry their payment, since amountPaid now lives on the
-- split rows.
INSERT INTO "TransactionSplit" ("id", "transactionId", "householdMemberId", "amountOwed", "amountPaid", "createdAt")
SELECT 'bf' || md5(t."id" || ':' || t."paidByMemberId"), t."id", t."paidByMemberId", 0, t."amount", CURRENT_TIMESTAMP
FROM "Transaction" t
WHERE t."paidByMemberId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "TransactionSplit" s WHERE s."transactionId" = t."id")
  AND NOT EXISTS (
    SELECT 1 FROM "TransactionSplit" s
    WHERE s."transactionId" = t."id" AND s."householdMemberId" = t."paidByMemberId"
  );

-- Backfill 3: a split transaction whose payer has since left the household
-- (paidByMemberId was SetNull) never produced a balance before. Treat every
-- remaining member as having paid their own share, so it doesn't suddenly
-- show up as "still due" or as a debt.
UPDATE "TransactionSplit" s
SET "amountPaid" = s."amountOwed"
FROM "Transaction" t
WHERE s."transactionId" = t."id"
  AND t."paidByMemberId" IS NULL;

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_paidByMemberId_fkey";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "paidByMemberId";

-- CreateTable
CREATE TABLE "MemberSettlement" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberSettlement_householdId_date_idx" ON "MemberSettlement"("householdId", "date");

-- CreateIndex
CREATE INDEX "MemberSettlement_fromMemberId_idx" ON "MemberSettlement"("fromMemberId");

-- CreateIndex
CREATE INDEX "MemberSettlement_toMemberId_idx" ON "MemberSettlement"("toMemberId");

-- AddForeignKey
ALTER TABLE "MemberSettlement" ADD CONSTRAINT "MemberSettlement_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSettlement" ADD CONSTRAINT "MemberSettlement_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSettlement" ADD CONSTRAINT "MemberSettlement_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
