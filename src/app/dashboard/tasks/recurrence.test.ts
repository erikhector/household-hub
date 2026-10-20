import { describe, expect, it } from "vitest";
import { getNextDueDate, isTaskOpen } from "@/app/dashboard/tasks/recurrence";

const createdAt = new Date("2026-08-01T09:00:00.000Z"); // a Saturday
const STOCKHOLM = "Europe/Stockholm";

const task = (completedAt: Date | null, recurrenceIntervalDays: number | null, created = createdAt) => ({
  completedAt,
  recurrenceIntervalDays,
  createdAt: created,
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
