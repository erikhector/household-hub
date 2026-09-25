-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "categoryOrderLearned" JSONB,
ADD COLUMN     "categoryOrderManual" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ShoppingListItem" ADD COLUMN     "checkedOffAt" TIMESTAMP(3);
