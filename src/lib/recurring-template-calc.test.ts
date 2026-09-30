import { describe, expect, it } from "vitest";
import {
  computeBudgetBalanceStatus,
  computeFixedMonthlySummary,
  computeRecurringBreakdown,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
  expandMonthlyDueDates,
  getPeriodBounds,
  getPeriodKey,
  monthlyEquivalentAmount,
} from "@/lib/recurring-template-calc";

describe("getPeriodKey", () => {
  it("formats a MONTHLY period as YYYY-MM", () => {
    expect(getPeriodKey(new Date(2026, 8, 6), "MONTHLY")).toBe("2026-09");
    expect(getPeriodKey(new Date(2026, 0, 1), "MONTHLY")).toBe("2026-01");
  });

  it("formats a YEARLY period as YYYY", () => {
    expect(getPeriodKey(new Date(2026, 8, 6), "YEARLY")).toBe("2026");
  });

  it("formats a WEEKLY period as an ISO week", () => {
    // Sunday 2026-09-06 falls in ISO week 36 of 2026 (Mon 2026-08-31 - Sun 2026-09-06).
    expect(getPeriodKey(new Date(2026, 8, 6), "WEEKLY")).toBe("2026-W36");
  });

  it("assigns the ISO week-numbering year at a year boundary", () => {
    // Thursday 2026-01-01 is in ISO week 1 of 2026.
    expect(getPeriodKey(new Date(2026, 0, 1), "WEEKLY")).toBe("2026-W01");
    // Friday 2027-01-01 belongs to ISO week 53 of 2026 (the week-numbering
    // year lags the calendar year here), not week 1 of 2027.
    expect(getPeriodKey(new Date(2027, 0, 1), "WEEKLY")).toBe("2026-W53");
  });

  it("gives dates within the same ISO week the same key regardless of weekday", () => {
    const monday = getPeriodKey(new Date(2026, 8, 7), "WEEKLY");
    const sunday = getPeriodKey(new Date(2026, 8, 13), "WEEKLY");
    expect(monday).toBe(sunday);
  });
});

describe("getPeriodBounds", () => {
  it("bounds a MONTHLY period to the calendar month", () => {
    expect(getPeriodBounds(new Date(2026, 8, 30, 23, 59), "MONTHLY")).toEqual({
      start: new Date(2026, 8, 1),
      end: new Date(2026, 9, 1),
    });
    expect(getPeriodBounds(new Date(2026, 11, 15), "MONTHLY").end).toEqual(new Date(2027, 0, 1));
  });

  it("bounds a YEARLY period to the calendar year", () => {
    expect(getPeriodBounds(new Date(2026, 5, 1), "YEARLY")).toEqual({
      start: new Date(2026, 0, 1),
      end: new Date(2027, 0, 1),
    });
  });

  it("bounds a WEEKLY period Monday to next Monday, including across a year boundary", () => {
    // Sunday 2026-09-06 is in the week starting Monday 2026-08-31.
    expect(getPeriodBounds(new Date(2026, 8, 6), "WEEKLY")).toEqual({
      start: new Date(2026, 7, 31),
      end: new Date(2026, 8, 7),
    });
    // Friday 2027-01-01 belongs to the week starting Monday 2026-12-28.
    expect(getPeriodBounds(new Date(2027, 0, 1), "WEEKLY")).toEqual({
      start: new Date(2026, 11, 28),
      end: new Date(2027, 0, 4),
    });
  });

  it("agrees with getPeriodKey on both edges for every frequency", () => {
    for (const frequency of ["WEEKLY", "MONTHLY", "YEARLY"] as const) {
      for (let d = 0; d < 400; d += 3) {
        const date = new Date(2026, 0, 1 + d, 13);
        const { start, end } = getPeriodBounds(date, frequency);
        const key = getPeriodKey(date, frequency);
        expect(getPeriodKey(start, frequency)).toBe(key);
        expect(getPeriodKey(new Date(end.getTime() - 1), frequency)).toBe(key);
        expect(getPeriodKey(end, frequency)).not.toBe(key);
      }
    }
  });
});

describe("computeTemplateStatuses", () => {
  const referenceDate = new Date(2026, 8, 6); // 2026-09-06
  const monthEnd = new Date(2026, 9, 1); // 2026-10-01, exclusive upper bound for September
  const createdAt = new Date(2026, 0, 1); // well before referenceDate/monthEnd
  const rent = { id: "rent", frequency: "MONTHLY" as const, active: true, createdAt };
  const gym = { id: "gym", frequency: "MONTHLY" as const, active: true, createdAt };
  const paused = { id: "paused", frequency: "MONTHLY" as const, active: false, createdAt };

  it("marks a template as due when nothing was logged or acknowledged this period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [],
      acks: [],
      referenceDate,
      monthEnd,
    });
    expect(rows).toEqual([{ template: rent, periodKey: "2026-09", status: "due" }]);
  });

  it("marks a template as posted when a transaction was logged from it this period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [],
      referenceDate,
      monthEnd,
    });
    expect(rows[0].status).toBe("posted");
  });

  it("marks a template as acknowledged when checked off without a transaction", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-09" }],
      referenceDate,
      monthEnd,
    });
    expect(rows[0].status).toBe("acknowledged");
  });

  it("prefers posted over acknowledged when both exist for the same period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-09" }],
      referenceDate,
      monthEnd,
    });
    expect(rows[0].status).toBe("posted");
  });

  it("ignores a transaction/ack from a prior period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 7, 3) }],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-08" }],
      referenceDate,
      monthEnd,
    });
    expect(rows[0].status).toBe("due");
  });

  it("omits paused (inactive) templates entirely", () => {
    const rows = computeTemplateStatuses({
      templates: [rent, paused],
      transactions: [],
      acks: [],
      referenceDate,
      monthEnd,
    });
    expect(rows.map((r) => r.template.id)).toEqual(["rent"]);
  });

  it("evaluates each template independently", () => {
    const rows = computeTemplateStatuses({
      templates: [rent, gym],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [{ recurringTemplateId: "gym", periodKey: "2026-09" }],
      referenceDate,
      monthEnd,
    });
    expect(rows.find((r) => r.template.id === "rent")?.status).toBe("posted");
    expect(rows.find((r) => r.template.id === "gym")?.status).toBe("acknowledged");
  });

  it("omits a template created on or after monthEnd — it doesn't backward propagate into an earlier period", () => {
    // Created in October, viewed period is September (monthEnd 2026-10-01).
    const futureTemplate = { ...rent, id: "future", createdAt: new Date(2026, 9, 1) };
    const rows = computeTemplateStatuses({
      templates: [rent, futureTemplate],
      transactions: [],
      acks: [],
      referenceDate,
      monthEnd,
    });
    expect(rows.map((r) => r.template.id)).toEqual(["rent"]);
  });

  it("includes a template starting in its own creation month", () => {
    // Created within September itself, still before monthEnd (2026-10-01).
    const sameMonthTemplate = { ...rent, id: "same-month", createdAt: new Date(2026, 8, 15) };
    const rows = computeTemplateStatuses({
      templates: [sameMonthTemplate],
      transactions: [],
      acks: [],
      referenceDate,
      monthEnd,
    });
    expect(rows.map((r) => r.template.id)).toEqual(["same-month"]);
  });
});

describe("monthlyEquivalentAmount", () => {
  it("passes MONTHLY amounts through unchanged", () => {
    expect(monthlyEquivalentAmount(100, "MONTHLY")).toBe(100);
  });

  it("scales WEEKLY amounts by 52/12 weeks-per-month", () => {
    expect(monthlyEquivalentAmount(100, "WEEKLY")).toBeCloseTo((100 * 52) / 12);
  });

  it("divides YEARLY amounts by 12", () => {
    expect(monthlyEquivalentAmount(1200, "YEARLY")).toBe(100);
  });
});

describe("computeFixedMonthlySummary", () => {
  const monthEnd = new Date(2026, 9, 1); // 2026-10-01, exclusive upper bound for September
  const createdAt = new Date(2026, 0, 1); // well before monthEnd

  it("sums active templates by type on a monthly-equivalent scale", () => {
    const summary = computeFixedMonthlySummary(
      [
        { amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true, createdAt },
        { amount: 1200, frequency: "MONTHLY", type: "EXPENSE", active: true, createdAt },
        { amount: 1200, frequency: "YEARLY", type: "EXPENSE", active: true, createdAt },
        { amount: 200, frequency: "MONTHLY", type: "SAVINGS", active: true, createdAt },
      ],
      monthEnd,
    );
    expect(summary).toEqual({ monthlyIncome: 3000, monthlyExpense: 1300, monthlySavings: 200 });
  });

  it("excludes paused (inactive) templates", () => {
    const summary = computeFixedMonthlySummary(
      [
        { amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true, createdAt },
        { amount: 500, frequency: "MONTHLY", type: "EXPENSE", active: false, createdAt },
      ],
      monthEnd,
    );
    expect(summary).toEqual({ monthlyIncome: 3000, monthlyExpense: 0, monthlySavings: 0 });
  });

  it("keeps savings out of both the income and expense totals", () => {
    const summary = computeFixedMonthlySummary(
      [{ amount: 500, frequency: "MONTHLY", type: "SAVINGS", active: true, createdAt }],
      monthEnd,
    );
    expect(summary.monthlyIncome).toBe(0);
    expect(summary.monthlyExpense).toBe(0);
    expect(summary.monthlySavings).toBe(500);
  });

  it("excludes a template created on or after monthEnd — it doesn't backward propagate into an earlier period", () => {
    const summary = computeFixedMonthlySummary(
      [
        { amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true, createdAt },
        {
          amount: 1000,
          frequency: "MONTHLY",
          type: "INCOME",
          active: true,
          createdAt: new Date(2026, 9, 1), // created right at monthEnd — October, not September
        },
      ],
      monthEnd,
    );
    expect(summary.monthlyIncome).toBe(3000);
  });

  it("includes a template created within the viewed month itself", () => {
    const summary = computeFixedMonthlySummary(
      [
        {
          amount: 1000,
          frequency: "MONTHLY",
          type: "INCOME",
          active: true,
          createdAt: new Date(2026, 8, 15), // created mid-September, before monthEnd
        },
      ],
      monthEnd,
    );
    expect(summary.monthlyIncome).toBe(1000);
  });
});

describe("computeRecurringMonthlyTotals", () => {
  const referenceDate = new Date(2026, 8, 6); // 2026-09-06

  it("returns one bucket per month for the requested range, oldest first", () => {
    const months = computeRecurringMonthlyTotals({ transactions: [], referenceDate, monthsBack: 3 });
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(months.every((m) => m.income === 0 && m.expense === 0 && m.savings === 0)).toBe(true);
  });

  it("sums logged fixed transactions into the month they fall in, by type", () => {
    const months = computeRecurringMonthlyTotals({
      transactions: [
        { type: "INCOME", amount: 3000, date: new Date(2026, 7, 1), recurringTemplateId: "salary" },
        { type: "EXPENSE", amount: 1200, date: new Date(2026, 7, 3), recurringTemplateId: "rent" },
        { type: "SAVINGS", amount: 200, date: new Date(2026, 8, 1), recurringTemplateId: "savings" },
      ],
      referenceDate,
      monthsBack: 2,
    });
    expect(months).toEqual([
      { month: "2026-08", income: 3000, expense: 1200, savings: 0 },
      { month: "2026-09", income: 0, expense: 0, savings: 200 },
    ]);
  });

  it("ignores transactions not linked to a recurring template", () => {
    const months = computeRecurringMonthlyTotals({
      transactions: [
        { type: "EXPENSE", amount: 50, date: new Date(2026, 8, 2), recurringTemplateId: null },
      ],
      referenceDate,
      monthsBack: 1,
    });
    expect(months).toEqual([{ month: "2026-09", income: 0, expense: 0, savings: 0 }]);
  });

  it("ignores a linked transaction that falls outside the requested range", () => {
    const months = computeRecurringMonthlyTotals({
      transactions: [
        { type: "EXPENSE", amount: 50, date: new Date(2026, 0, 2), recurringTemplateId: "rent" },
      ],
      referenceDate,
      monthsBack: 1,
    });
    expect(months).toEqual([{ month: "2026-09", income: 0, expense: 0, savings: 0 }]);
  });
});

describe("computeRecurringBreakdown", () => {
  const monthEnd = new Date(2026, 9, 1); // 2026-10-01, exclusive upper bound for September
  const createdAt = new Date(2026, 0, 1); // well before monthEnd

  it("returns only the requested type's active templates, on a monthly-equivalent scale, largest first", () => {
    const items = computeRecurringBreakdown(
      [
        { id: "rent", name: "Rent", amount: 1200, frequency: "MONTHLY", type: "EXPENSE", active: true, createdAt },
        { id: "gym", name: "Gym", amount: 600, frequency: "YEARLY", type: "EXPENSE", active: true, createdAt },
        { id: "salary", name: "Salary", amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true, createdAt },
      ],
      "EXPENSE",
      monthEnd,
    );
    expect(items).toEqual([
      { id: "rent", name: "Rent", monthlyAmount: 1200 },
      { id: "gym", name: "Gym", monthlyAmount: 50 },
    ]);
  });

  it("excludes paused (inactive) templates", () => {
    const items = computeRecurringBreakdown(
      [{ id: "rent", name: "Rent", amount: 1200, frequency: "MONTHLY", type: "EXPENSE", active: false, createdAt }],
      "EXPENSE",
      monthEnd,
    );
    expect(items).toEqual([]);
  });

  it("excludes a template created on or after monthEnd — same cutoff as computeFixedMonthlySummary", () => {
    const items = computeRecurringBreakdown(
      [
        {
          id: "future",
          name: "Future",
          amount: 1200,
          frequency: "MONTHLY",
          type: "EXPENSE",
          active: true,
          createdAt: new Date(2026, 9, 1),
        },
      ],
      "EXPENSE",
      monthEnd,
    );
    expect(items).toEqual([]);
  });
});

describe("computeBudgetBalanceStatus", () => {
  it("is 'deficit' once fixed costs exceed fixed income", () => {
    expect(computeBudgetBalanceStatus({ monthlyIncome: 1000, monthlyExpense: 1001 })).toBe("deficit");
  });

  it("is 'tight' when the leftover is within the threshold ratio of income", () => {
    // 5% left over — under the 10% threshold.
    expect(computeBudgetBalanceStatus({ monthlyIncome: 1000, monthlyExpense: 950 })).toBe("tight");
  });

  it("is 'balanced' when the leftover comfortably clears the threshold ratio", () => {
    expect(computeBudgetBalanceStatus({ monthlyIncome: 1000, monthlyExpense: 500 })).toBe("balanced");
  });

  it("is 'balanced' at exactly zero net with no income planned, rather than guessing at a ratio", () => {
    expect(computeBudgetBalanceStatus({ monthlyIncome: 0, monthlyExpense: 0 })).toBe("balanced");
  });
});

describe("expandMonthlyDueDates (GAP-3 calendar feed)", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const keys = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));

  it("returns one date per month in the window", () => {
    expect(keys(expandMonthlyDueDates(3, utc(2026, 1, 1), utc(2026, 4, 30)))).toEqual([
      "2026-01-03",
      "2026-02-03",
      "2026-03-03",
      "2026-04-03",
    ]);
  });

  it("includes both window edges and excludes days just outside them", () => {
    expect(keys(expandMonthlyDueDates(15, utc(2026, 1, 15), utc(2026, 3, 15)))).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
    ]);
    expect(keys(expandMonthlyDueDates(15, utc(2026, 1, 16), utc(2026, 3, 14)))).toEqual(["2026-02-15"]);
  });

  it("clamps a day past the end of a short month to its last day", () => {
    expect(keys(expandMonthlyDueDates(31, utc(2026, 1, 1), utc(2026, 4, 30)))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("uses 29 February in a leap year", () => {
    expect(keys(expandMonthlyDueDates(30, utc(2028, 2, 1), utc(2028, 2, 29)))).toEqual(["2028-02-29"]);
  });

  it("crosses year boundaries", () => {
    expect(keys(expandMonthlyDueDates(10, utc(2026, 11, 1), utc(2027, 2, 28)))).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
    ]);
  });

  it("ignores the time of day on the window's edges", () => {
    expect(
      keys(expandMonthlyDueDates(5, new Date("2026-05-05T23:59:00Z"), new Date("2026-06-05T00:01:00Z"))),
    ).toEqual(["2026-05-05", "2026-06-05"]);
  });

  it("returns nothing for an empty or inverted window, or an invalid day", () => {
    expect(expandMonthlyDueDates(5, utc(2026, 5, 6), utc(2026, 5, 31))).toEqual([]);
    expect(expandMonthlyDueDates(5, utc(2026, 6, 1), utc(2026, 5, 1))).toEqual([]);
    expect(expandMonthlyDueDates(0, utc(2026, 1, 1), utc(2026, 12, 31))).toEqual([]);
    expect(expandMonthlyDueDates(1.5, utc(2026, 1, 1), utc(2026, 12, 31))).toEqual([]);
  });

  it("returns UTC midnights", () => {
    const [date] = expandMonthlyDueDates(7, utc(2026, 7, 1), utc(2026, 7, 31));
    expect(date.toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});
