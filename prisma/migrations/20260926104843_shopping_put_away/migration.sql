-- CreateEnum
CREATE TYPE "InventorySyncMode" AS ENUM ('ON_CHECK', 'ON_PUT_AWAY');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'PUT_AWAY_REMINDER';

-- AlterTable
-- Every household that already exists keeps today's behaviour (a tick
-- updates inventory straight away), so nobody's habit changes under them;
-- only households created from now on start in the two-phase put-away flow.
-- Added with ON_CHECK as the default so the existing rows are filled with
-- it, then the default is switched for new rows.
ALTER TABLE "Household" ADD COLUMN     "inventorySyncMode" "InventorySyncMode" NOT NULL DEFAULT 'ON_CHECK';
ALTER TABLE "Household" ALTER COLUMN "inventorySyncMode" SET DEFAULT 'ON_PUT_AWAY';

-- AlterTable
ALTER TABLE "ShoppingList" ADD COLUMN     "putAwayRemindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ShoppingListItem" ADD COLUMN     "checkedOffByUserId" TEXT,
ADD COLUMN     "priceRecordedAt" TIMESTAMP(3),
ADD COLUMN     "putAwayAt" TIMESTAMP(3);

-- Backfill: every row already ticked was counted into inventory by the old
-- tick, so it's already put away. Without this each one would read as
-- "incoming" (purchased, putAwayAt null) and a put-away would count it a
-- second time. Dated by the tick when there is one, else the list's
-- completion (receipt-applied rows), else now.
UPDATE "ShoppingListItem" AS item
SET "putAwayAt" = COALESCE(item."checkedOffAt", list."completedAt", now())
FROM "ShoppingList" AS list
WHERE list."id" = item."shoppingListId"
  AND item."purchased" = true;
