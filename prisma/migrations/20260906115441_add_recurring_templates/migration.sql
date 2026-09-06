-- AlterTable
ALTER TABLE "PersonalTransaction" ADD COLUMN     "recurringTemplateId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "recurringTemplateId" TEXT;

-- CreateTable
CREATE TABLE "RecurringTemplate" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TransactionType" NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "dayOfMonth" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringTemplateAck" (
    "id" TEXT NOT NULL,
    "recurringTemplateId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringTemplateAck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecurringTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TransactionType" NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "dayOfMonth" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRecurringTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecurringTemplateAck" (
    "id" TEXT NOT NULL,
    "personalRecurringTemplateId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRecurringTemplateAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringTemplate_householdId_idx" ON "RecurringTemplate"("householdId");

-- CreateIndex
CREATE INDEX "RecurringTemplateAck_recurringTemplateId_idx" ON "RecurringTemplateAck"("recurringTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringTemplateAck_recurringTemplateId_periodKey_key" ON "RecurringTemplateAck"("recurringTemplateId", "periodKey");

-- CreateIndex
CREATE INDEX "PersonalRecurringTemplate_userId_idx" ON "PersonalRecurringTemplate"("userId");

-- CreateIndex
CREATE INDEX "PersonalRecurringTemplateAck_personalRecurringTemplateId_idx" ON "PersonalRecurringTemplateAck"("personalRecurringTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalRecurringTemplateAck_personalRecurringTemplateId_pe_key" ON "PersonalRecurringTemplateAck"("personalRecurringTemplateId", "periodKey");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplate" ADD CONSTRAINT "RecurringTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringTemplateAck" ADD CONSTRAINT "RecurringTemplateAck_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "RecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "PersonalRecurringTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecurringTemplate" ADD CONSTRAINT "PersonalRecurringTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecurringTemplate" ADD CONSTRAINT "PersonalRecurringTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PersonalBudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalRecurringTemplateAck" ADD CONSTRAINT "PersonalRecurringTemplateAck_personalRecurringTemplateId_fkey" FOREIGN KEY ("personalRecurringTemplateId") REFERENCES "PersonalRecurringTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
