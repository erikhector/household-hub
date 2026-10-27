-- PERF-3: indexes for hot lookups that were full scans.

-- requireHousehold: membership by userId alone, on every request.
CREATE INDEX "HouseholdMember_userId_idx" ON "HouseholdMember"("userId");

-- Recurring-template lookups and the SetNull on template delete.
CREATE INDEX "Transaction_recurringTemplateId_idx" ON "Transaction"("recurringTemplateId");

-- Month-scoped personal budget reads (PERF-2). The leading column covers
-- everything the old userId-only index did, so it is replaced.
DROP INDEX "PersonalTransaction_userId_idx";
CREATE INDEX "PersonalTransaction_userId_date_idx" ON "PersonalTransaction"("userId", "date");

-- Per-item price history in date order (PERF-12); replaces the
-- inventoryItemId-only index for the same reason.
DROP INDEX "PriceHistory_inventoryItemId_idx";
CREATE INDEX "PriceHistory_inventoryItemId_date_idx" ON "PriceHistory"("inventoryItemId", "date");
