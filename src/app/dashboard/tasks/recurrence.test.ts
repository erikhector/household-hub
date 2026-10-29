import { describe, expect, it } from "vitest";
import {
  getNextDueDate,
  isClosedBySkipOnly,
  isTaskOpen,
  skippedUntilFor,
  withLocalSkip,
} from "@/app/dashboard/tasks/recurrence";

const createdAt = new Date("2026-08-01T09:00:00.000Z"); // a Saturday
const STOCKHOLM = "Europe/Stockholm";

const task = (
  completedAt: Date | null,
  recurrenceIntervalDays: number | null,
  created = createdAt,
  recurrenceAnchorAt: Date | null = null,
) => ({
  completedAt,
  recurrenceIntervalDays,
  createdAt: created,
  recurrenceAnchorAt,
});

describe("isTaskOpen", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("is open when never completed, recurring or not", () => {
    expect(isTaskOpen(task(null, null), now)).toBe(true);
    expect(isTaskOpen(task(null, 3), now)).toBe(true);
  });

  it("stays completed (not open) for a non-recurring task, however long ago it was completed", () => {
    expect(isTaskOpen(task(new Date("2020-01-01T00:00:00.000Z"), null), now)).toBe(false);
  });

  it("stays completed for a recurring task before its next local midnight", () => {
    expect(isTaskOpen(task(new Date("2026-09-13T12:00:00.000Z"), 3), now)).toBe(false);
  });

  it("is open again at exactly the next due moment, and not a millisecond before", () => {
    const completedAt = new Date("2026-09-11T12:00:00.000Z"); // due 2026-09-14T00:00Z
    expect(isTaskOpen(task(completedAt, 3), new Date("2026-09-13T23:59:59.999Z"))).toBe(false);
    expect(isTaskOpen(task(completedAt, 3), new Date("2026-09-14T00:00:00.000Z"))).toBe(true);
  });

  it("is open again for a recurring task well past its interval", () => {
    expect(isTaskOpen(task(new Date("2026-09-01T12:00:00.000Z"), 3), now)).toBe(true);
  });

  it("reopens a daily task at local midnight, not 24 h after the tick (UX-137)", () => {
    const completedAt = new Date("2026-09-14T21:40:00.000Z"); // 23:40 in Stockholm
    // 00:30 the next day in Stockholm is already a new day.
    expect(isTaskOpen(task(completedAt, 1), new Date("2026-09-14T22:30:00.000Z"), STOCKHOLM)).toBe(true);
    // In UTC the same instant is still the tick's day.
    expect(isTaskOpen(task(completedAt, 1), new Date("2026-09-14T22:30:00.000Z"), "UTC")).toBe(false);
  });
});

describe("getNextDueDate", () => {
  it("is null when never completed, recurring or not", () => {
    expect(getNextDueDate(task(null, null))).toBeNull();
    expect(getNextDueDate(task(null, 3))).toBeNull();
  });

  it("is null for a non-recurring task, however recently it was completed", () => {
    expect(getNextDueDate(task(new Date("2026-09-14T12:00:00.000Z"), null))).toBeNull();
  });

  it("is the start of the local day `interval` days after the tick's day, for a short interval", () => {
    expect(getNextDueDate(task(new Date("2026-09-13T12:00:00.000Z"), 3))).toEqual(
      new Date("2026-09-16T00:00:00.000Z"),
    );
  });

  it("is the next local midnight for a daily task ticked at 23:40", () => {
    // 23:40 CEST (UTC+2) on 14 Sept -> due 00:00 CEST on 15 Sept = 22:00Z.
    expect(getNextDueDate(task(new Date("2026-09-14T21:40:00.000Z"), 1), STOCKHOLM)).toEqual(
      new Date("2026-09-14T22:00:00.000Z"),
    );
  });

  it("does not read a daily tick as today's date once the day has rolled over", () => {
    // Ticked 23:40 local; the label date (the due day) is tomorrow, never today.
    const due = getNextDueDate(task(new Date("2026-09-14T21:40:00.000Z"), 1), STOCKHOLM)!;
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: STOCKHOLM }).format(d);
    expect(day(due)).toBe("2026-09-15");
  });

  it("handles a time zone behind UTC, where local midnight is later in UTC", () => {
    // 20:00 PDT (UTC-7) on 14 Sept is 03:00Z on 15 Sept: the local day is the 14th.
    expect(getNextDueDate(task(new Date("2026-09-15T03:00:00.000Z"), 1), "America/Los_Angeles")).toEqual(
      new Date("2026-09-15T07:00:00.000Z"),
    );
  });

  it("follows a daylight-saving change: local midnight, not 24 h", () => {
    // Stockholm leaves summer time on 2026-10-25 (02:00 -> 01:00). Ticked on
    // the 24th (UTC+2), a daily task is due at 00:00 on the 25th (22:00Z)...
    expect(getNextDueDate(task(new Date("2026-10-24T10:00:00.000Z"), 1), STOCKHOLM)).toEqual(
      new Date("2026-10-24T22:00:00.000Z"),
    );
    // ...and ticked on the 25th (a 25 h day), due at 00:00 on the 26th (UTC+1).
    expect(getNextDueDate(task(new Date("2026-10-25T10:00:00.000Z"), 1), STOCKHOLM)).toEqual(
      new Date("2026-10-25T23:00:00.000Z"),
    );
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(getNextDueDate(task(new Date("2026-09-13T12:00:00.000Z"), 1), "Not/AZone")).toEqual(
      new Date("2026-09-14T00:00:00.000Z"),
    );
  });

  describe("a reset anchor (UX-144)", () => {
    // Created Saturday 08-01 but re-anchored on Thursday 2026-08-06.
    const anchor = new Date("2026-08-06T09:00:00.000Z");

    it("a late tick keeps the new weekday, not the creation weekday", () => {
      // Open since Thu 08-13, done Sat 08-15: still due Thu 08-20.
      expect(getNextDueDate(task(new Date("2026-08-15T10:00:00.000Z"), 7, createdAt, anchor))).toEqual(
        new Date("2026-08-20T00:00:00.000Z"),
      );
    });

    it("null falls back to createdAt", () => {
      expect(getNextDueDate(task(new Date("2026-08-15T10:00:00.000Z"), 7, createdAt, null))).toEqual(
        new Date("2026-08-22T00:00:00.000Z"),
      );
    });
  });

  describe("weekly tasks keep their anchor day", () => {
    // createdAt is Saturday 2026-08-01, so the anchor is Saturday: 08-08, 08-15, ...
    it("a tick on the anchor day is due again a week later", () => {
      expect(getNextDueDate(task(new Date("2026-08-15T10:00:00.000Z"), 7))).toEqual(
        new Date("2026-08-22T00:00:00.000Z"),
      );
    });

    it("a late tick (Monday) leaves the schedule on Saturdays", () => {
      // Open since Sat 08-15, done Mon 08-17: still due Sat 08-22.
      expect(getNextDueDate(task(new Date("2026-08-17T10:00:00.000Z"), 7))).toEqual(
        new Date("2026-08-22T00:00:00.000Z"),
      );
    });

    it("an early tick (Thursday) does not move the chore to Thursdays", () => {
      // Open since Sat 08-15, done Thu 08-20: reopens Sat 08-22, not Thu 08-27.
      expect(getNextDueDate(task(new Date("2026-08-20T10:00:00.000Z"), 7))).toEqual(
        new Date("2026-08-22T00:00:00.000Z"),
      );
    });

    it("keeps the anchor across a longer gap, two weeks late", () => {
      expect(getNextDueDate(task(new Date("2026-09-02T10:00:00.000Z"), 7))).toEqual(
        new Date("2026-09-05T00:00:00.000Z"),
      );
    });

    it("anchors a 14-day chore on every second anchor day", () => {
      // Anchor 08-01, then 08-15, 08-29. Done Tue 08-18 -> due Sat 08-29.
      expect(getNextDueDate(task(new Date("2026-08-18T10:00:00.000Z"), 14))).toEqual(
        new Date("2026-08-29T00:00:00.000Z"),
      );
    });

    it("a tick before the anchor day counts as the first occurrence", () => {
      expect(getNextDueDate(task(new Date("2026-07-30T10:00:00.000Z"), 7))).toEqual(
        new Date("2026-08-08T00:00:00.000Z"),
      );
    });

    it("works in the user's zone: Saturday 00:30 in Stockholm is still Friday in UTC", () => {
      const created = new Date("2026-08-07T22:30:00.000Z"); // Sat 00:30 CEST
      const completedAt = new Date("2026-08-17T08:00:00.000Z"); // Mon
      expect(getNextDueDate(task(completedAt, 7, created), STOCKHOLM)).toEqual(
        new Date("2026-08-21T22:00:00.000Z"), // Sat 08-22 00:00 CEST
      );
    });
  });
});

// GAP-60: "Skip this time" closes a recurring task until `skippedUntil`
// without a completion being recorded.
describe("skippedUntil (GAP-60)", () => {
  const skipped = (completedAt: Date | null, interval: number | null, skippedUntil: Date | null) => ({
    ...task(completedAt, interval),
    skippedUntil,
  });
  const skippedUntil = new Date("2026-09-15T12:00:00.000Z");

  describe("isTaskOpen", () => {
    it("is closed before skippedUntil, never completed or not", () => {
      const before = new Date("2026-09-15T11:59:59.999Z");
      expect(isTaskOpen(skipped(null, 1, skippedUntil), before)).toBe(false);
      expect(isTaskOpen(skipped(new Date("2026-09-01T12:00:00.000Z"), 1, skippedUntil), before)).toBe(false);
    });

    it("reopens at exactly skippedUntil, and stays open after", () => {
      expect(isTaskOpen(skipped(null, 1, skippedUntil), skippedUntil)).toBe(true);
      expect(isTaskOpen(skipped(null, 1, skippedUntil), new Date("2026-09-16T00:00:00.000Z"))).toBe(true);
      const old = new Date("2026-09-01T12:00:00.000Z");
      expect(isTaskOpen(skipped(old, 1, skippedUntil), skippedUntil)).toBe(true);
    });

    it("stays closed by the schedule when that is later than the skip", () => {
      // Ticked on the 14th, due 00:00 on the 17th; the earlier skip end changes nothing.
      const completedAt = new Date("2026-09-14T12:00:00.000Z");
      expect(isTaskOpen(skipped(completedAt, 3, skippedUntil), new Date("2026-09-16T23:00:00.000Z"))).toBe(false);
    });

    it("ignores a null skippedUntil", () => {
      expect(isTaskOpen(skipped(null, 1, null), new Date("2026-09-14T12:00:00.000Z"))).toBe(true);
    });

    it("ignores a leftover skippedUntil on a non-recurring task", () => {
      expect(isTaskOpen(skipped(null, null, skippedUntil), new Date("2026-09-14T12:00:00.000Z"))).toBe(true);
    });
  });

  describe("getNextDueDate", () => {
    it("is skippedUntil for a never-completed task", () => {
      expect(getNextDueDate(skipped(null, 2, skippedUntil))).toEqual(skippedUntil);
    });

    it("is the later of the schedule and the skip", () => {
      // Schedule: ticked 09-13 + 3 days = 09-16 00:00Z, later than the skip.
      const completedAt = new Date("2026-09-13T12:00:00.000Z");
      expect(getNextDueDate(skipped(completedAt, 3, skippedUntil))).toEqual(new Date("2026-09-16T00:00:00.000Z"));
      // Schedule: ticked 09-01 + 3 days = 09-04, long before the skip ends.
      expect(getNextDueDate(skipped(new Date("2026-09-01T12:00:00.000Z"), 3, skippedUntil))).toEqual(skippedUntil);
    });

    it("is still null for a non-recurring task", () => {
      expect(getNextDueDate(skipped(null, null, skippedUntil))).toBeNull();
    });
  });

  describe("isClosedBySkipOnly", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");

    it("is true when the schedule alone would have the task open", () => {
      expect(isClosedBySkipOnly(skipped(null, 1, skippedUntil), now)).toBe(true);
      expect(isClosedBySkipOnly(skipped(new Date("2026-09-01T12:00:00.000Z"), 1, skippedUntil), now)).toBe(true);
    });

    it("is false when a real completion closes it too, the skip has ended, or there is none", () => {
      expect(isClosedBySkipOnly(skipped(new Date("2026-09-14T08:00:00.000Z"), 3, skippedUntil), now)).toBe(false);
      expect(isClosedBySkipOnly(skipped(null, 1, new Date("2026-09-14T11:00:00.000Z")), now)).toBe(false);
      expect(isClosedBySkipOnly(skipped(null, 1, null), now)).toBe(false);
    });
  });

  it("skippedUntilFor is one interval on from now", () => {
    expect(skippedUntilFor(new Date("2026-09-14T12:00:00.000Z"), 3)).toEqual(new Date("2026-09-17T12:00:00.000Z"));
  });

  it("withLocalSkip closes the row without faking a completion, and undoes", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    const row = { completed: false, skipped: false, skippedUntil: null, recurrenceIntervalDays: 2, completedAt: null };
    const after = withLocalSkip(row, true, now);
    expect(after).toMatchObject({ completed: true, skipped: true, completedAt: null });
    expect(after.skippedUntil).toEqual(new Date("2026-09-16T12:00:00.000Z"));
    expect(withLocalSkip(after, false, now)).toMatchObject({ completed: false, skipped: false, skippedUntil: null });
  });
});
