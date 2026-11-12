-- TASK_DUE (GAP-74) stops storing assignee display names. Each line in
-- "taskLines" becomes just the task title, and the assignee goes in the
-- parallel "taskAssigneeIds" as a User id ("" = unassigned), resolved to a
-- name at read time so it disappears with the member.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "taskAssigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: rows written before this migration hold "Title (Name)". Strip the
-- trailing bracket so no name stays behind, and mark every line unassigned,
-- since the old rows never recorded who the name belonged to. A title that
-- really ended in a bracket ("Call the vet (Rex)") loses it in these old
-- entries only; the task itself is untouched, and a once-a-day nudge row is
-- not worth keeping a former member's name for.
UPDATE "Notification"
SET
  "taskLines" = ARRAY(
    SELECT regexp_replace(line, ' \([^()]*\)$', '')
    FROM unnest("taskLines") WITH ORDINALITY AS t(line, position)
    ORDER BY position
  ),
  "taskAssigneeIds" = array_fill(''::TEXT, ARRAY[cardinality("taskLines")])
WHERE "kind" = 'TASK_DUE' AND "taskLines" IS NOT NULL;
