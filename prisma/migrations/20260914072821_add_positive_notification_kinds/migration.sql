-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'RESTOCKED';
ALTER TYPE "NotificationKind" ADD VALUE 'LIST_CLEARED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "shoppingListId" TEXT;

-- CreateIndex
CREATE INDEX "Notification_shoppingListId_idx" ON "Notification"("shoppingListId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
