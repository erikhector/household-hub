-- Recurring bill splitting (opt-in per template, mirrors TransactionSplit —
-- see prisma/schema.prisma's RecurringTemplateSplit doc comment and
-- PERSONAL_HOUSEHOLD_BUDGET_LINK.md). Lets a RecurringTemplate record how
-- its expected cost is divided among household members before anyone logs a
-- Transaction for it, so a "due" period can still carry a per-member share.
-- No "paid by" column here (unlike Transaction) since a template is never
-- itself "paid". Every pre-existing template has no rows here, so it's
-- completely unaffected until a household member opts it into a split.

-- CreateTable
CREATE TABLE "RecurringTemplateSplit" (
    "id" TEXT NOT NULL,
    "recurringTemplateId" TEXT NOT NULL,
    "householdMemberId" TEXT NOT NULL,
    "amountOwed" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTemplateSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringTemplateSplit_recurringTemplateId_idx" ON "RecurringTemplateSplit"("recurringTemplateId");

-- CreateIndex
CREATE INDEX "RecurringTemplateSplit_householdMemberId_idx" ON "RecurringTemplateSplit"("householdMemberId");

-- CreateIndex
-- Name truncated to Postgres's 63-character identifier limit, matching what
-- `prisma migrate dev` itself generates for this constraint.
CREATE UNIQUE INDEX "RecurringTemplateSplit_recurringTemplateId_householdMemberI_key" ON "RecurringTemplateSplit"("recurringTemplateId", "householdMemberId");

-- AddForeignKey
ALTER TABLE "RecurringTemplateSplit" ADD CONSTRAINT "RecurringTemplateSplit_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- Cascade: an ex-member's own split rows are simply removed with them — the
-- same tradeoff TransactionSplit.householdMemberId makes, for the same
-- explicitly-out-of-scope edge case (no re-normalizing remaining splits).
ALTER TABLE "RecurringTemplateSplit" ADD CONSTRAINT "RecurringTemplateSplit_householdMemberId_fkey" FOREIGN KEY ("householdMemberId") REFERENCES "HouseholdMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
