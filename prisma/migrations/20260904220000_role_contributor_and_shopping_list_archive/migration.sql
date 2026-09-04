-- Rename the "MEMBER" household role to "CONTRIBUTOR" (clearer product
-- terminology: every non-owner is a contributor to the shared household).
ALTER TYPE "HouseholdRole" RENAME VALUE 'MEMBER' TO 'CONTRIBUTOR';

-- AlterTable
ALTER TABLE "HouseholdMember" ALTER COLUMN "role" SET DEFAULT 'CONTRIBUTOR';

-- Add the "ARCHIVED" status so households can archive old shopping lists
-- instead of only completing or deleting them.
ALTER TYPE "ShoppingListStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "ShoppingList" ADD COLUMN "archivedAt" TIMESTAMP(3);
