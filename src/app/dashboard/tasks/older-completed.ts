// UX-105: a one-off that was ticked long ago has nothing left to say, but it
// stays in the list for good (there's no archive), so the "Completed" section
// grew without end, in creation order, below the tasks that matter. Past this
// many days they collapse behind "Show N older" instead of being deleted, so
// nothing is lost and no data changes.
export const OLDER_COMPLETED_DAYS = 7;

/**
 * Whether a task belongs behind "Show N older": shown completed, a one-off
 * (a repeating task reopens by itself and its "Next due" is still useful, so
 * it never collapses) and ticked more than `OLDER_COMPLETED_DAYS` before `now`.
 */
export function isOlderCompletedOneOff(
  task: { completed: boolean; completedAt: Date | null; recurrenceIntervalDays: number | null },
  now: Date,
): boolean {
  if (!task.completed || task.recurrenceIntervalDays !== null || task.completedAt === null) return false;
  return now.getTime() - task.completedAt.getTime() > OLDER_COMPLETED_DAYS * 24 * 60 * 60 * 1000;
}
