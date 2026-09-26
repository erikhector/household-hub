// Pure date helpers, no mocking needed. Every date here is normalized to
// UTC midnight (see the file's own doc comment), so these tests are
// TZ-independent by construction — unlike budget-date-utils.ts's local-time
// helpers.
import { describe, expect, it } from "vitest";
import { addDays, getWeekStart, isDateKey, parseDateKey, toDateKey } from "@/app/dashboard/meal-planning/date-utils";

describe("toDateKey / parseDateKey", () => {
  it("round-trips a UTC date through the yyyy-mm-dd key", () => {
    const date = new Date("2026-03-15T00:00:00.000Z");
    expect(toDateKey(date)).toBe("2026-03-15");
    expect(parseDateKey("2026-03-15").toISOString()).toBe(date.toISOString());
  });

  it("takes only the date portion, ignoring any time-of-day already on the Date", () => {
    expect(toDateKey(new Date("2026-03-15T23:59:59.999Z"))).toBe("2026-03-15");
  });
});

describe("isDateKey", () => {
  it("accepts a well-formed yyyy-mm-dd string", () => {
    expect(isDateKey("2026-03-15")).toBe(true);
  });

  it("rejects malformed strings and non-strings", () => {
    expect(isDateKey("2026-3-15")).toBe(false);
    expect(isDateKey("03-15-2026")).toBe(false);
    expect(isDateKey("2026-03-15T00:00:00Z")).toBe(false);
    expect(isDateKey("")).toBe(false);
    expect(isDateKey(null)).toBe(false);
    expect(isDateKey(20260315)).toBe(false);
  });
});

describe("addDays", () => {
  it("adds days within the same month", () => {
    expect(toDateKey(addDays(parseDateKey("2026-03-10"), 3))).toBe("2026-03-13");
  });

  it("rolls over a month boundary", () => {
    expect(toDateKey(addDays(parseDateKey("2026-03-30"), 3))).toBe("2026-04-02");
  });

  it("rolls over a year boundary", () => {
    expect(toDateKey(addDays(parseDateKey("2026-12-30"), 3))).toBe("2027-01-02");
  });

  it("handles a February leap day correctly (2028 is a leap year)", () => {
    expect(toDateKey(addDays(parseDateKey("2028-02-28"), 1))).toBe("2028-02-29");
    expect(toDateKey(addDays(parseDateKey("2028-02-29"), 1))).toBe("2028-03-01");
  });

  it("skips the leap day in a non-leap year (2026)", () => {
    expect(toDateKey(addDays(parseDateKey("2026-02-28"), 1))).toBe("2026-03-01");
  });

  it("goes backward with a negative count", () => {
    expect(toDateKey(addDays(parseDateKey("2026-03-01"), -1))).toBe("2026-02-28");
  });

  it("never drifts a day from local-timezone DST shifts, since everything is UTC", () => {
    // 2026-03-29 is a DST spring-forward date in Europe; a UTC-normalized
    // helper must not skip or repeat a day around it.
    expect(toDateKey(addDays(parseDateKey("2026-03-28"), 1))).toBe("2026-03-29");
    expect(toDateKey(addDays(parseDateKey("2026-03-29"), 1))).toBe("2026-03-30");
  });
});

describe("getWeekStart", () => {
  it("returns the same date when given a Monday", () => {
    // 2026-03-16 is a Monday.
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-16")))).toBe("2026-03-16");
  });

  it("returns the preceding Monday for every other day of the week", () => {
    // Week of 2026-03-16 (Mon) .. 2026-03-22 (Sun).
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-17")))).toBe("2026-03-16"); // Tue
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-18")))).toBe("2026-03-16"); // Wed
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-19")))).toBe("2026-03-16"); // Thu
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-20")))).toBe("2026-03-16"); // Fri
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-21")))).toBe("2026-03-16"); // Sat
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-22")))).toBe("2026-03-16"); // Sun
  });

  it("rolls the week start back over a month boundary", () => {
    // 2026-03-01 is a Sunday; its Monday is in February.
    expect(toDateKey(getWeekStart(parseDateKey("2026-03-01")))).toBe("2026-02-23");
  });

  it("rolls the week start back over a year boundary", () => {
    // 2027-01-01 is a Friday; its Monday is in the prior year.
    expect(toDateKey(getWeekStart(parseDateKey("2027-01-01")))).toBe("2026-12-28");
  });

  it("ignores any time-of-day, normalizing to UTC midnight", () => {
    const withTime = new Date("2026-03-18T23:30:00.000Z");
    const start = getWeekStart(withTime);
    expect(start.toISOString()).toBe("2026-03-16T00:00:00.000Z");
  });
});
