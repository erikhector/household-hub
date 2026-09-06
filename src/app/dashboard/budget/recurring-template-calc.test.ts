import { describe, expect, it } from "vitest";
import {
  computeFixedMonthlySummary,
  computeRecurringMonthlyTotals,
  computeTemplateStatuses,
  getPeriodKey,
  monthlyEquivalentAmount,
} from "./recurring-template-calc";

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

describe("computeTemplateStatuses", () => {
  const referenceDate = new Date(2026, 8, 6); // 2026-09-06
  const rent = { id: "rent", frequency: "MONTHLY" as const, active: true };
  const gym = { id: "gym", frequency: "MONTHLY" as const, active: true };
  const paused = { id: "paused", frequency: "MONTHLY" as const, active: false };

  it("marks a template as due when nothing was logged or acknowledged this period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [],
      acks: [],
      referenceDate,
    });
    expect(rows).toEqual([{ template: rent, periodKey: "2026-09", status: "due" }]);
  });

  it("marks a template as posted when a transaction was logged from it this period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [],
      referenceDate,
    });
    expect(rows[0].status).toBe("posted");
  });

  it("marks a template as acknowledged when checked off without a transaction", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-09" }],
      referenceDate,
    });
    expect(rows[0].status).toBe("acknowledged");
  });

  it("prefers posted over acknowledged when both exist for the same period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-09" }],
      referenceDate,
    });
    expect(rows[0].status).toBe("posted");
  });

  it("ignores a transaction/ack from a prior period", () => {
    const rows = computeTemplateStatuses({
      templates: [rent],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 7, 3) }],
      acks: [{ recurringTemplateId: "rent", periodKey: "2026-08" }],
      referenceDate,
    });
    expect(rows[0].status).toBe("due");
  });

  it("omits paused (inactive) templates entirely", () => {
    const rows = computeTemplateStatuses({
      templates: [rent, paused],
      transactions: [],
      acks: [],
      referenceDate,
    });
    expect(rows.map((r) => r.template.id)).toEqual(["rent"]);
  });

  it("evaluates each template independently", () => {
    const rows = computeTemplateStatuses({
      templates: [rent, gym],
      transactions: [{ recurringTemplateId: "rent", date: new Date(2026, 8, 3) }],
      acks: [{ recurringTemplateId: "gym", periodKey: "2026-09" }],
      referenceDate,
    });
    expect(rows.find((r) => r.template.id === "rent")?.status).toBe("posted");
    expect(rows.find((r) => r.template.id === "gym")?.status).toBe("acknowledged");
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
  it("sums active templates by type on a monthly-equivalent scale", () => {
    const summary = computeFixedMonthlySummary([
      { amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true },
      { amount: 1200, frequency: "MONTHLY", type: "EXPENSE", active: true },
      { amount: 1200, frequency: "YEARLY", type: "EXPENSE", active: true },
      { amount: 200, frequency: "MONTHLY", type: "SAVINGS", active: true },
    ]);
    expect(summary).toEqual({ monthlyIncome: 3000, monthlyExpense: 1300, monthlySavings: 200 });
  });

  it("excludes paused (inactive) templates", () => {
    const summary = computeFixedMonthlySummary([
      { amount: 3000, frequency: "MONTHLY", type: "INCOME", active: true },
      { amount: 500, frequency: "MONTHLY", type: "EXPENSE", active: false },
    ]);
    expect(summary).toEqual({ monthlyIncome: 3000, monthlyExpense: 0, monthlySavings: 0 });
  });

  it("keeps savings out of both the income and expense totals", () => {
    const summary = computeFixedMonthlySummary([
      { amount: 500, frequency: "MONTHLY", type: "SAVINGS", active: true },
    ]);
    expect(summary.monthlyIncome).toBe(0);
    expect(summary.monthlyExpense).toBe(0);
    expect(summary.monthlySavings).toBe(500);
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
