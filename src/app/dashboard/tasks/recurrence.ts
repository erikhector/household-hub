// Household task recurrence (see JOY_GAP_BACKLOG.md item 6, superseded for
// recurring tasks per later request) — deliberately not an rrule/weekday
// schedule, just "reopen N days after it was last completed". There's no
// completion-history table, so a recurring task's open/completed state is
// derived lazily from `completedAt` + `recurrenceIntervalDays` at read time
// rather than stored: completing it again simply overwrites `completedAt`,
// the same write a non-recurring task's toggle already does. This file is
// the one place that logic lives — page.tsx (list split) and actions.ts
// (toggle direction) both call isTaskOpen with the same `now` so they never
// disagree about a task's current state.

export type RecurrenceFields = {
  completedAt: Date | null;
  recurrenceIntervalDays: number | null;
};

/**
 * Whether the task should currently be treated as open (not completed).
 * A non-recurring task is open iff `completedAt` is null. A recurring task
 * is also open once `now` has reached `completedAt + recurrenceIntervalDays`
 * days, even though `completedAt` itself is left untouched — the earlier
 * completion still belongs to whatever week it actually happened in (e.g.
 * for the weekly recap).
 */
export function isTaskOpen(task: RecurrenceFields, now: Date): boolean {
  if (task.completedAt === null) return true;
  if (task.recurrenceIntervalDays === null) return false;

  const dueAgainAt = new Date(
    task.completedAt.getTime() + task.recurrenceIntervalDays * 24 * 60 * 60 * 1000,
  );
  return now >= dueAgainAt;
}
