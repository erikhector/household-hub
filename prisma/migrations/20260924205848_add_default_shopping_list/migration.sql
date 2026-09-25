-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "autoAddLowStockToList" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ShoppingList" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- At most one ACTIVE default list per household (AUTO-8). Prisma's schema
-- language can't express a partial index, so it lives here only; the actions
-- also enforce it (getOrCreateDefaultShoppingList inserts with
-- ON CONFLICT DO NOTHING against this index, then re-reads the winner).
CREATE UNIQUE INDEX "ShoppingList_one_active_default_per_household"
  ON "ShoppingList"("householdId")
  WHERE "isDefault" AND "status" = 'ACTIVE';
