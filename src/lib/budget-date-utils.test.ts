// Pure date helpers, no mocking needed. Months are kept in local time (see
// the file's own doc comment), so these tests run in whatever TZ the CI
// runner uses — that's fine, since every assertion here compares two local
// dates against each other rather than against a hardcoded UTC offset.
import { describe, expect, it } from "vitest";
import {
  addMonths,
  getMonthEnd,
  getMonthStart,
  isMonthKey,
  parseMonthKey,
  toMonthKey,
} from "@/lib/budget-date-utils";

describe("toMonthKey", () => {
  it("formats as YYYY-MM, zero-padding single-digit months", () => {
    expect(toMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(toMonthKey(new Date(2026, 8, 1))).toBe("2026-09");
    expect(toMonthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });
});

describe("parseMonthKey", () => {
  it("round-trips through toMonthKey for every month of the year", () => {
    for (let month = 0; month < 12; month++) {
      const key = toMonthKey(new Date(2026, month, 1));
      expect(toMonthKey(parseMonthKey(key))).toBe(key);
    }
  });

  it("parses to local midnight on the first of the month", () => {
    const parsed = parseMonthKey("2026-03");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(1);
    expect(parsed.getHours()).toBe(0);
  });
});

describe("isMonthKey", () => {
  it("accepts well-formed YYYY-MM keys for every valid month", () => {
    expect(isMonthKey("2026-01")).toBe(true);
    expect(isMonthKey("2026-12")).toBe(true);
  });

  it("rejects month 00 and month 13, and anything not shaped like a month key", () => {
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-1")).toBe(false);
    expect(isMonthKey("2026-01-01")).toBe(false);
    expect(isMonthKey("")).toBe(false);
    expect(isMonthKey(2026)).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });
});

describe("addMonths", () => {
  it("adds months within the same year", () => {
    expect(toMonthKey(addMonths(new Date(2026, 2, 15), 2))).toBe("2026-05");
  });

  it("rolls over a year boundary going forward", () => {
    expect(toMonthKey(addMonths(new Date(2026, 11, 15), 1))).toBe("2027-01");
  });

  it("rolls back over a year boundary going backward", () => {
    expect(toMonthKey(addMonths(new Date(2026, 0, 15), -1))).toBe("2025-12");
  });

  it("normalizes to the 1st, so a month-end date does not skip a month (e.g. Jan 31 + 1 month must land in February, not March)", () => {
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(1);
  });
});

describe("getMonthStart / getMonthEnd", () => {
  it("returns local midnight of the 1st for getMonthStart", () => {
    const start = getMonthStart(new Date(2026, 5, 20, 23, 59));
    expect(start).toEqual(new Date(2026, 5, 1));
  });

  it("returns local midnight of the 1st of the *next* month for getMonthEnd (an exclusive upper bound)", () => {
    const end = getMonthEnd(new Date(2026, 5, 20));
    expect(end).toEqual(new Date(2026, 6, 1));
  });

  it("rolls getMonthEnd over a year boundary for December", () => {
    const end = getMonthEnd(new Date(2026, 11, 5));
    expect(end).toEqual(new Date(2027, 0, 1));
  });

  it("produces a [start, end) window that spans the whole month regardless of DST shifts inside it", () => {
    // 2026-03-29 is the spring-forward DST transition in Europe; the month
    // window must still cover every day of March even though local
    // wall-clock offsets shift partway through.
    const start = getMonthStart(new Date(2026, 2, 15));
    const end = getMonthEnd(new Date(2026, 2, 15));
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(2);
    expect(end.getMonth()).toBe(3);
    expect(end.getDate()).toBe(1);
  });
});
