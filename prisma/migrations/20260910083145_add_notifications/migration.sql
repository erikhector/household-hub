-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('OUT_OF_STOCK', 'MEAL_NOT_LOGGED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "inventoryItemId" TEXT,
    "mealPlanEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_householdId_dismissedAt_idx" ON "Notification"("householdId", "dismissedAt");

-- CreateIndex
CREATE INDEX "Notification_inventoryItemId_idx" ON "Notification"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_mealPlanEntryId_key" ON "Notification"("mealPlanEntryId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_mealPlanEntryId_fkey" FOREIGN KEY ("mealPlanEntryId") REFERENCES "MealPlanEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
