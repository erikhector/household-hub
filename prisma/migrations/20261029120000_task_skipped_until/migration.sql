-- GAP-60: "Skip this time" on a repeating task. Nullable, no default: every
-- existing row reads as never skipped.
ALTER TABLE "HouseholdTask" ADD COLUMN "skippedUntil" TIMESTAMP(3);
