-- CreateIndex
CREATE INDEX "InventoryItem_householdId_expiresAt_idx" ON "InventoryItem"("householdId", "expiresAt");

-- CreateIndex
CREATE INDEX "Transaction_householdId_date_idx" ON "Transaction"("householdId", "date");
