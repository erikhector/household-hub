import { describe, expect, it } from "vitest";
import { dayHeading, groupByDay, localDateKey, utcDateKey } from "@/lib/budget-transaction-days";

const row = (iso: string, type: "INCOME" | "EXPENSE" | "SAVINGS", amount: number) => ({
  date: new Date(iso),
  type,
  amount,
});

describe("utcDateKey / localDateKey", () => {
  it("reads a stored date (UTC midnight) as the calendar day it was entered for", () => {
    expect(utcDateKey(new Date("2026-10-09T00:00:00Z"))).toBe("2026-10-09");
  });

  it("reads the viewer's own calendar day", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("groupByDay", () => {
  it("groups consecutive rows by day, keeping their order, with each day's net", () => {
    const rows = [
      row("2026-10-09T00:00:00Z", "INCOME", 100),
      row("2026-10-09T00:00:00Z", "EXPENSE", 30),
      row("2026-10-09T00:00:00Z", "SAVINGS", 20),
      row("2026-10-08T00:00:00Z", "EXPENSE", 5),
    ];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.key)).toEqual(["2026-10-09", "2026-10-08"]);
    // Savings leave the spendable money, like an expense.
    expect(groups[0].net).toBe(50);
    expect(groups[0].rows).toEqual(rows.slice(0, 3));
    expect(groups[1].net).toBe(-5);
    expect(groups[1].rows).toEqual([rows[3]]);
  });

  it("returns nothing for no rows", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe("dayHeading", () => {
  it("names today and yesterday in the viewer's language", () => {
    expect(dayHeading("2026-10-15", "2026-10-15", "en")).toBe("Today");
    expect(dayHeading("2026-10-14", "2026-10-15", "en")).toBe("Yesterday");
    expect(dayHeading("2026-10-15", "2026-10-15", "sv")).toBe("I dag");
    expect(dayHeading("2026-10-14", "2026-10-15", "sv")).toBe("I går");
  });

  it("counts yesterday across a month boundary", () => {
    expect(dayHeading("2026-09-30", "2026-10-01", "en")).toBe("Yesterday");
  });

  it("names any other day by weekday and date, without the year", () => {
    expect(dayHeading("2026-10-09", "2026-10-15", "en")).toBe("Friday, Oct 9");
    expect(dayHeading("2026-10-09", "2026-10-15", "sv")).toBe("fredag 9 okt.");
  });

  it("doesn't call a future day today", () => {
    expect(dayHeading("2026-10-16", "2026-10-15", "en")).toBe("Friday, Oct 16");
  });
});
