-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "createdFromList" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "everStocked" BOOLEAN NOT NULL DEFAULT false;

-- UX-125: nothing recorded that an item was ever stocked, so backfill the
-- evidence there is: stock now, a recorded price, a bought list row or a
-- last-known price. Already-empty items without any of those stay false (we
-- can't tell them from phantoms) until they're restocked.
UPDATE "InventoryItem" i SET "everStocked" = true
WHERE i."quantity" > 0
   OR i."lastKnownPrice" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "PriceHistory" p WHERE p."inventoryItemId" = i."id")
   OR EXISTS (SELECT 1 FROM "ShoppingListItem" s WHERE s."inventoryItemId" = i."id" AND s."purchased" = true);
