-- GAP-61: pin a note to the top of the notes board. Nullable, no default:
-- every existing note reads as not pinned.
ALTER TABLE "HouseholdNote" ADD COLUMN "pinnedAt" TIMESTAMP(3);
