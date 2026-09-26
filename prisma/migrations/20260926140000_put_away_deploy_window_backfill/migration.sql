-- Re-runs shopping_put_away's backfill for rows the *previous* app version
-- ticked while the deploy that added the put-away step was still building.
-- `prisma migrate deploy` runs before `next build` (scripts/vercel-build.mjs),
-- so the old code keeps serving for the length of the build after the first
-- backfill has already run; every tick it made in that window counted stock
-- (old behaviour) but left "putAwayAt" null, so it would read as still
-- waiting and a put-away would count it a second time.
--
-- Narrowed to what only the old code can have produced: an ON_CHECK
-- household (the new code stamps "putAwayAt" on every ON_CHECK tick) and no
-- "checkedOffByUserId" (the new code records the ticker on every signed-in
-- tick and every receipt). Idempotent, so it's safe to run again by hand
-- after the deploy is live — see DEPLOYMENT.md, "Put-away deploy window".
UPDATE "ShoppingListItem" AS item
SET "putAwayAt" = COALESCE(item."checkedOffAt", list."completedAt", now())
FROM "ShoppingList" AS list, "Household" AS household
WHERE list."id" = item."shoppingListId"
  AND household."id" = list."householdId"
  AND household."inventorySyncMode" = 'ON_CHECK'
  AND item."purchased" = true
  AND item."putAwayAt" IS NULL
  AND item."checkedOffByUserId" IS NULL;
