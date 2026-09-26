-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
