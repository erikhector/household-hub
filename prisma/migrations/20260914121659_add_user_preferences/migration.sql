-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inventoryViewPrefs" JSONB,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'dark';
