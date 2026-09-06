-- CreateTable
CREATE TABLE "PersonalBudgetCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalBudgetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" "TransactionType" NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceFrequency" "RecurrenceFrequency",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalBudgetCategory_userId_idx" ON "PersonalBudgetCategory"("userId");

-- CreateIndex
CREATE INDEX "PersonalTransaction_userId_idx" ON "PersonalTransaction"("userId");

-- AddForeignKey
ALTER TABLE "PersonalBudgetCategory" ADD CONSTRAINT "PersonalBudgetCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTransaction" ADD CONSTRAINT "PersonalTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PersonalBudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
