-- GAP-71: the household's required diet tags (keys from RECIPE_TAGS).
ALTER TABLE "Household" ADD COLUMN "requiredTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
