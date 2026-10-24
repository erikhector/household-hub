// UX-134: the payday-month helpers in budget-date-utils.ts. Local dates
// compared with local dates, like budget-date-utils.test.ts.
import { describe, expect, it } from "vitest";
import {
  dateInPeriod,
  normalizeStartDay,
  periodBounds,
  periodKeyOf,
  periodLabelDate,
  periodRangeLabel,
} from "./budget-date-utils";

describe("normalizeStartDay", () => {
  it("keeps 1 to 28 and falls back to 1 for anything else", () => {
    expect(normalizeStartDay(25)).toBe(25);
    expect(normalizeStartDay(28)).toBe(28);
    expect(normalizeStartDay(29)).toBe(1);
    expect(normalizeStartDay(0)).toBe(1);
    expect(normalizeStartDay(2.5)).toBe(1);
    expect(normalizeStartDay("25")).toBe(1);
    expect(normalizeStartDay(undefined)).toBe(1);
  });
});

describe("periodKeyOf", () => {
  it("is the calendar month with start day 1", () => {
    expect(periodKeyOf(new Date(2026, 8, 28))).toBe("2026-09");
    expect(periodKeyOf(new Date(2026, 8, 28), 1)).toBe("2026-09");
  });

  it("names a period after the month it ends in", () => {
    expect(periodKeyOf(new Date(2026, 8, 24), 25)).toBe("2026-09");
    expect(periodKeyOf(new Date(2026, 8, 25), 25)).toBe("2026-10");
    expect(periodKeyOf(new Date(2026, 8, 28), 25)).toBe("2026-10");
    expect(periodKeyOf(new Date(2026, 9, 1), 25)).toBe("2026-10");
    expect(periodKeyOf(new Date(2026, 9, 24), 25)).toBe("2026-10");
  });

  it("rolls the year over for a period starting in December", () => {
    expect(periodKeyOf(new Date(2026, 11, 25), 25)).toBe("2027-01");
    expect(periodKeyOf(new Date(2027, 0, 24), 25)).toBe("2027-01");
  });

  it("agrees with periodBounds for every day of a year", () => {
    for (const startDay of [1, 15, 25, 28]) {
      for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d = new Date(2026, d.getMonth(), d.getDate() + 1)) {
        const { start, end } = periodBounds(periodKeyOf(d, startDay), startDay);
        expect(d >= start && d < end).toBe(true);
      }
    }
  });
});

describe("periodLabelDate", () => {
  it("is the 1st of the month the period is named for", () => {
    expect(periodLabelDate(new Date(2026, 8, 28), 25)).toEqual(new Date(2026, 9, 1));
    expect(periodLabelDate(new Date(2026, 8, 28), 1)).toEqual(new Date(2026, 8, 1));
  });
});

describe("periodBounds", () => {
  it("is the calendar month with start day 1", () => {
    expect(periodBounds("2026-10")).toEqual({ start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) });
  });

  it("runs from the start day of the previous month to the same day", () => {
    expect(periodBounds("2026-10", 25)).toEqual({ start: new Date(2026, 8, 25), end: new Date(2026, 9, 25) });
  });

  it("crosses a year boundary", () => {
    expect(periodBounds("2027-01", 25)).toEqual({ start: new Date(2026, 11, 25), end: new Date(2027, 0, 25) });
  });

  it("tiles without gaps or overlaps", () => {
    expect(periodBounds("2026-09", 25).end).toEqual(periodBounds("2026-10", 25).start);
  });
});

describe("dateInPeriod", () => {
  it("puts a day before the start day in the period's second month", () => {
    expect(dateInPeriod("2026-10", 25, 1)).toEqual(new Date(2026, 9, 1));
    expect(dateInPeriod("2026-10", 25, 24)).toEqual(new Date(2026, 9, 24));
  });

  it("puts a day from the start day on in the period's first month", () => {
    expect(dateInPeriod("2026-10", 25, 25)).toEqual(new Date(2026, 8, 25));
    expect(dateInPeriod("2026-10", 25, 28)).toEqual(new Date(2026, 8, 28));
  });

  it("clamps a day the month lacks", () => {
    expect(dateInPeriod("2026-10", 25, 31)).toEqual(new Date(2026, 8, 30));
    expect(dateInPeriod("2026-02", 1, 31)).toEqual(new Date(2026, 1, 28));
    expect(dateInPeriod("2026-03", 28, 30)).toEqual(new Date(2026, 1, 28));
  });

  it("is the day of the calendar month with start day 1", () => {
    expect(dateInPeriod("2026-10", 1, 28)).toEqual(new Date(2026, 9, 28));
  });

  it("always lands inside the period", () => {
    for (const startDay of [1, 10, 25, 28]) {
      const { start, end } = periodBounds("2027-03", startDay);
      for (let day = 1; day <= 31; day++) {
        const date = dateInPeriod("2027-03", startDay, day);
        expect(date >= start && date < end).toBe(true);
      }
    }
  });
});

describe("periodRangeLabel", () => {
  it("is null for a calendar month", () => {
    expect(periodRangeLabel("2026-10", 1, "en")).toBeNull();
  });

  it("names the first and last day", () => {
    expect(periodRangeLabel("2026-10", 25, "en")).toBe("Sep 25 – Oct 24");
  });
});
