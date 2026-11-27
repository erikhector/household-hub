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
//    whenever the interval is edited, or (weekly days, below) to a picked
//    weekday. Rows from before the column (null) keep reading `createdAt`.
//
// Weekly days: a repeat whose interval is a whole number of weeks (every
// week, every 2 weeks) can be put on a chosen weekday in the task dialog.
// That is only a matter of where the anchor falls, so it needs no column of
// its own: `anchorForWeekday` sets it to such a day. A task that has never
// been done gets the next one (today when today is that day): an anchor in
// the future means the repeat hasn't started, so the task stays out of the
// open list until that day (`isUpcoming`) rather than showing as due at
// once, and a tick before then does it early (the tick falls in the
// interval just before the anchor, which counts as the first occurrence).
// A task that has been done gets the latest one on or before the day of its
// last tick instead, so the windows above carry on from that tick whatever
// day the edit is made: moved from Mondays to Saturdays after Monday's tick,
// it is next due the Saturday after, not a week later (counting from the
// edit day, an edit made on a Saturday made the tick cover that day). A tick longer ago than one interval before the
// anchor belongs to no occurrence, so the task is next due on the anchor day
// itself (overdue, when that is past).
//
// GAP-60: "Skip this time" closes a recurring task until `skippedUntil`
// (now + one interval when skipped) without writing `completedAt`, which
// feeds the weekly recap and "Last done by". The task's next due moment is
// then the later of the schedule's own and `skippedUntil`, and a tick clears
// the skip.

import { isTimeZone } from "@/lib/time-zone";

export type RecurrenceFields = {
  completedAt: Date | null;
  recurrenceIntervalDays: number | null;
  /** The anchor day of a weekly-or-longer task when `recurrenceAnchorAt` is null (see the header). */
  createdAt: Date;
  /** UX-144: the anchor day, re-set when the interval is edited; null falls back to `createdAt`. */
  recurrenceAnchorAt: Date | null;
  /**
   * GAP-60: closed until this moment by "Skip this time"; null when never
   * skipped. Required, not optional, so a query that forgets to select it is
   * a type error instead of a skipped task that silently shows as open.
   */
  skippedUntil: Date | null;
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
export function startOfLocalDay(dayNumber: number, timeZone: string): Date {
  const wall = dayNumber * MS_PER_DAY;
  // Two passes: the offset at the first guess may differ from the offset at
  // the answer when a DST change falls between them.
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone));
}

/** When a skip made `now` ends: one interval on, the same span a tick would have closed it for. */
export function skippedUntilFor(now: Date, recurrenceIntervalDays: number): Date {
  return new Date(now.getTime() + recurrenceIntervalDays * MS_PER_DAY);
}

/** The schedule's own next due moment, ignoring any skip. */
function scheduledNextDue(task: RecurrenceFields, timeZone: string): Date | null {
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
  if (completedDay <= anchorDay - interval) return startOfLocalDay(anchorDay, zone);
  const occurrence = Math.max(0, Math.floor((completedDay - anchorDay) / interval));
  return startOfLocalDay(anchorDay + (occurrence + 1) * interval, zone);
}

/**
 * The moment a recurring task becomes due again: a local midnight, or the
 * end of a skip (GAP-60) when that is later. Null for a non-recurring task
 * or one that has neither been completed nor skipped (there's nothing to
 * count forward from).
 */
export function getNextDueDate(task: RecurrenceFields, timeZone = "UTC"): Date | null {
  if (task.recurrenceIntervalDays === null) return null;
  const scheduled = scheduledNextDue(task, timeZone);
  const skippedUntil = task.skippedUntil ?? null;
  if (skippedUntil === null) return scheduled;
  return scheduled !== null && scheduled > skippedUntil ? scheduled : skippedUntil;
}

/**
 * Whether the task should currently be treated as open (not completed).
 * A non-recurring task is open iff `completedAt` is null. A recurring task
 * is also open once `now` has reached its next due moment, even though
 * `completedAt` itself is left untouched — the earlier completion still
 * belongs to whatever week it actually happened in (e.g. for the weekly
 * recap). A skip (GAP-60) closes it until `skippedUntil`, completed or not.
 */
export function isTaskOpen(task: RecurrenceFields, now: Date, timeZone = "UTC"): boolean {
  if (task.recurrenceIntervalDays === null) return task.completedAt === null;
  if (task.completedAt === null && (task.skippedUntil ?? null) === null) return !isUpcoming(task, now, timeZone);

  const dueAgainAt = getNextDueDate(task, timeZone);
  if (dueAgainAt === null) return true;
  return now >= dueAgainAt;
}

/**
 * Whether a repeating task has never been done (or skipped) and its anchor
 * day is still ahead: a weekly chore put on Saturday on a Wednesday. It is
 * closed, but not done, so the list shows it as upcoming and a tick on it
 * completes it early (the first occurrence) instead of reopening it.
 */
export function isUpcoming(task: RecurrenceFields, now: Date, timeZone = "UTC"): boolean {
  if (task.recurrenceIntervalDays === null || task.completedAt !== null || (task.skippedUntil ?? null) !== null) {
    return false;
  }
  const zone = safeTimeZone(timeZone);
  return localDayNumber(task.recurrenceAnchorAt ?? task.createdAt, zone) > localDayNumber(now, zone);
}

/** Whether an interval can be put on a weekday: a whole number of weeks. */
export function keepsWeekday(recurrenceIntervalDays: number | null): boolean {
  return recurrenceIntervalDays !== null && recurrenceIntervalDays % 7 === 0;
}

/** The weekday (0 Sunday … 6 Saturday, as `Date#getDay`) of `instant`'s local day. */
export function localWeekday(instant: Date, timeZone: string): number {
  // Day 0 (1970-01-01) was a Thursday.
  return (((localDayNumber(instant, safeTimeZone(timeZone)) + 4) % 7) + 7) % 7;
}

/**
 * The start of a local day on `weekday` (0 Sunday … 6 Saturday): the next
 * one, or with `"latest"` the last one, today included either way.
 */
export function anchorForWeekday(
  weekday: number,
  now: Date,
  timeZone: string,
  which: "next" | "latest" = "next",
): Date {
  const zone = safeTimeZone(timeZone);
  const ahead = (((weekday - localWeekday(now, zone)) % 7) + 7) % 7;
  const offset = which === "next" ? ahead : ahead === 0 ? 0 : ahead - 7;
  return startOfLocalDay(localDayNumber(now, zone) + offset, zone);
}

/**
 * Whether the task is closed only because it was skipped (GAP-60): a skip
 * is running and the schedule alone would have it open. Decides what a tick
 * on it undoes: just the skip, leaving the real last completion alone.
 */
export function isClosedBySkipOnly(task: RecurrenceFields, now: Date, timeZone = "UTC"): boolean {
  if ((task.skippedUntil ?? null) === null || isTaskOpen(task, now, timeZone)) return false;
  return isTaskOpen({ ...task, skippedUntil: null }, now, timeZone);
}

/** A skip as the list shows it before the server answers (the local twin of skipTaskAction and its undo). */
export function withLocalSkip<
  T extends { completed: boolean; skipped: boolean; skippedUntil: Date | null; recurrenceIntervalDays: number | null },
>(task: T, skipped: boolean, now: Date): T {
  if (!skipped) return { ...task, completed: false, skipped: false, skippedUntil: null };
  return {
    ...task,
    completed: true,
    skipped: true,
    skippedUntil: task.recurrenceIntervalDays === null ? null : skippedUntilFor(now, task.recurrenceIntervalDays),
  };
}
