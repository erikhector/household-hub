// UX-133: when a task is due, and how urgent that makes it.
//
// Two sources, one number. Everything here works in *local calendar days*
// (days since 1970-01-01, the unit recurrence.ts already uses), so "today",
// "overdue by 5 days" and the sort never depend on the time of day:
//  - A one-off task carries an optional `dueDate`, a plain calendar date
//    (`@db.Date`, which Prisma returns as UTC midnight of that date, so its
//    day number is just the date).
//  - A repeating task has no stored due date. It is due from the moment it
//    (re)opens, which UX-137 already settled: the next due moment after the
//    last tick (`getNextDueDate`), or the anchor day while it has never been
//    ticked. "Water the plants" every 3 days, done 8 days ago, reopened 5
//    days ago, so it reads "Overdue · 5 days". `dueDate` is ignored for it,
//    so a task that gains a repeat later can't carry a stale date.

import { getNextDueDate, localDayNumber, type RecurrenceFields } from "@/app/dashboard/tasks/recurrence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TaskDueFields = RecurrenceFields & {
  /** A one-off's chosen due date (UTC midnight of the calendar date). */
  dueDate: Date | null;
};

export type TaskUrgency = "overdue" | "today" | "later" | "none";

/** The calendar day a `dueDate` column value names, as days since 1970-01-01. */
export function dueDateToDayNumber(dueDate: Date): number {
  return Math.floor(dueDate.getTime() / MS_PER_DAY);
}

/** Today's local day number in `timeZone`. */
export function todayDayNumber(now: Date, timeZone = "UTC"): number {
  return localDayNumber(now, timeZone);
}

/**
 * The local day the task is (or was, or will be) due, or null when it has no
 * due day (a one-off with no date).
 */
export function getTaskDueDay(task: TaskDueFields, timeZone = "UTC"): number | null {
  if (task.recurrenceIntervalDays !== null) {
    if (task.completedAt === null) return localDayNumber(task.recurrenceAnchorAt ?? task.createdAt, timeZone);
    const next = getNextDueDate(task, timeZone);
    return next === null ? null : localDayNumber(next, timeZone);
  }
  return task.dueDate === null ? null : dueDateToDayNumber(task.dueDate);
}

export function getTaskUrgency(dueDay: number | null, today: number): TaskUrgency {
  if (dueDay === null) return "none";
  if (dueDay < today) return "overdue";
  return dueDay === today ? "today" : "later";
}

/** Whole days past due; 0 when it is due today or later. */
export function daysOverdue(dueDay: number | null, today: number): number {
  return dueDay === null ? 0 : Math.max(0, today - dueDay);
}

const URGENCY_RANK = { overdue: 0, today: 1, later: 2, none: 3 } satisfies Record<TaskUrgency, number>;

/**
 * Orders open tasks: overdue first (the longest overdue on top), then due
 * today, then due later (soonest first), then tasks with no date. Ties keep
 * their incoming order (Array.prototype.sort is stable), which is oldest
 * first, so a list with no dates reads exactly as it did before.
 */
export function sortByUrgency<T extends { dueDay: number | null }>(tasks: readonly T[], today: number): T[] {
  return [...tasks].sort((a, b) => {
    const byRank = URGENCY_RANK[getTaskUrgency(a.dueDay, today)] - URGENCY_RANK[getTaskUrgency(b.dueDay, today)];
    if (byRank !== 0) return byRank;
    return (a.dueDay ?? 0) - (b.dueDay ?? 0);
  });
}

/** A `YYYY-MM-DD` form value as the UTC-midnight `Date` the column stores; null when it isn't a real date. */
export function parseDueDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date : null;
}

/** The inverse of `parseDueDateInput`, for the edit dialog's date field. */
export function formatDueDateInput(dueDate: Date): string {
  return dueDate.toISOString().slice(0, 10);
}
