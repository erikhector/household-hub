// Household task recurrence (see docs/archive/JOY_GAP_BACKLOG.md item 6, superseded for
// recurring tasks per later request) — deliberately not an rrule/weekday
// schedule, just a repeat interval in days. There's no completion-history
// table, so a recurring task's open/completed state is derived lazily from
// `completedAt` + `recurrenceIntervalDays` at read time rather than stored:
// completing it again simply overwrites `completedAt`, the same write a
// non-recurring task's toggle already does. This file is the one place that
// logic lives — page.tsx (list split) and actions.ts (toggle direction) both
// call isTaskOpen with the same `now` and time zone so they never disagree
// about a task's current state.
//
// UX-137: the schedule runs on the household's *local calendar days*, not on
// the tick's exact instant. Counting 24 h from the tick left a daily chore
// ticked at 23:40 under "Completed" all the next day, and let a late tick
// push the schedule back for good. Two cases, split at a week:
//  - Under 7 days (daily, every 2 or 3 days): the interval counts from the
//    start of the local day it was ticked, so a daily chore reopens at 00:00.
//  - A week or more: the chore keeps a fixed anchor day. Occurrences fall on
//    the anchor's day, then every N days after it; ticking in one
//    occurrence's window (late, or early because it was already open) closes
//    it until the next occurrence, so a Saturday chore done on Thursday
//    stays a Saturday chore. The anchor is the local day in
//    `recurrenceAnchorAt` (UX-144): set when a repeat is created and re-set
//    whenever the interval is edited, so "every Thursday" is a matter of
//    editing the task on a Thursday. Rows from before the column (null) keep
//    reading `createdAt`.

import { isTimeZone } from "@/lib/time-zone";

export type RecurrenceFields = {
  completedAt: Date | null;
  recurrenceIntervalDays: number | null;
  /** The anchor day of a weekly-or-longer task when `recurrenceAnchorAt` is null (see the header). */
  createdAt: Date;
  /** UX-144: the anchor day, re-set when the interval is edited; null falls back to `createdAt`. */
  recurrenceAnchorAt: Date | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Intervals of at least this many days keep a fixed anchor day. */
const ANCHORED_FROM_DAYS = 7;

/** `timeZone` when it's a zone Intl knows, else UTC (a bad cookie value). */
const safeTimeZone = (timeZone: string) => (isTimeZone(timeZone) ? timeZone : "UTC");

/** The calendar day `instant` falls on in `timeZone`, as days since 1970-01-01. */
export function localDayNumber(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a local calendar day (days since 1970-01-01) starts in `timeZone`. */
function startOfLocalDay(dayNumber: number, timeZone: string): Date {
  const wall = dayNumber * MS_PER_DAY;
  // Two passes: the offset at the first guess may differ from the offset at
  // the answer when a DST change falls between them.
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone));
}

/**
 * The moment a recurring task becomes due again: a local midnight. Null for
 * a non-recurring task or one that hasn't been completed yet (there's
 * nothing to count forward from).
 */
export function getNextDueDate(task: RecurrenceFields, timeZone = "UTC"): Date | null {
  if (task.completedAt === null || task.recurrenceIntervalDays === null) return null;

  const zone = safeTimeZone(timeZone);
  const interval = task.recurrenceIntervalDays;
  const completedDay = localDayNumber(task.completedAt, zone);

  if (interval < ANCHORED_FROM_DAYS) return startOfLocalDay(completedDay + interval, zone);

  // The occurrence this tick belongs to is the latest one that has begun
  // (the task has been open since then); the next one is a full interval on.
  // A task ticked before its anchor day (an imported row) counts as the
  // first occurrence.
  const anchorDay = localDayNumber(task.recurrenceAnchorAt ?? task.createdAt, zone);
  const occurrence = Math.max(0, Math.floor((completedDay - anchorDay) / interval));
  return startOfLocalDay(anchorDay + (occurrence + 1) * interval, zone);
}

/**
 * Whether the task should currently be treated as open (not completed).
 * A non-recurring task is open iff `completedAt` is null. A recurring task
 * is also open once `now` has reached its next due moment, even though
 * `completedAt` itself is left untouched — the earlier completion still
 * belongs to whatever week it actually happened in (e.g. for the weekly
 * recap).
 */
export function isTaskOpen(task: RecurrenceFields, now: Date, timeZone = "UTC"): boolean {
  if (task.completedAt === null) return true;

  const dueAgainAt = getNextDueDate(task, timeZone);
  if (dueAgainAt === null) return false;
  return now >= dueAgainAt;
}
