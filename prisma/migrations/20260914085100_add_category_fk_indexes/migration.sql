-- CreateIndex
CREATE INDEX "PersonalRecurringTemplate_categoryId_idx" ON "PersonalRecurringTemplate"("categoryId");

-- CreateIndex
CREATE INDEX "PersonalTransaction_categoryId_idx" ON "PersonalTransaction"("categoryId");

-- CreateIndex
CREATE INDEX "PersonalTransaction_recurringTemplateId_idx" ON "PersonalTransaction"("recurringTemplateId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_inventoryItemId_idx" ON "RecipeIngredient"("inventoryItemId");

-- CreateIndex
CREATE INDEX "RecurringTemplate_categoryId_idx" ON "RecurringTemplate"("categoryId");

-- CreateIndex
CREATE INDEX "ShoppingListItem_inventoryItemId_idx" ON "ShoppingListItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");
