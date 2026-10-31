import { describe, expect, it } from "vitest";
import {
  barHeightPercent,
  niceCeiling,
  trimLeadingEmpty,
  countUpValue,
  dailyAllowance,
  vsUsual,
  usualFor,
  projectMonthEnd,
  withSpendHistory,
  type ProjectionTransaction,
} from "@/lib/chart-calc";

const expense = (categoryId: string, amount: number, date: Date) => ({
  categoryId,
  type: "EXPENSE" as const,
  amount,
  date,
});

describe("withSpendHistory", () => {
  const monthStart = new Date(2026, 9, 1); // October 2026

  it("sums each row's spending per month, oldest first, viewed month last", () => {
    const rows = withSpendHistory(
      [{ id: "food" }],
      [
        expense("food", 100, new Date(2026, 9, 3)),
        expense("food", 50, new Date(2026, 9, 20)),
        expense("food", 80, new Date(2026, 7, 15)),
        expense("food", 30, new Date(2026, 4, 1)), // May: the first of six
      ],
      monthStart,
    );
    expect(rows[0].history).toEqual([30, 0, 0, 80, 0, 150]);
  });

  it("ignores transactions outside the window, of another type or category", () => {
    const rows = withSpendHistory(
      [{ id: "food" }],
      [
        expense("food", 10, new Date(2026, 9, 5)),
        expense("food", 999, new Date(2026, 3, 30)), // April: before the window
        expense("food", 999, new Date(2026, 10, 1)), // November: after it
        expense("rent", 999, new Date(2026, 9, 5)),
        { categoryId: "food", type: "INCOME", amount: 999, date: new Date(2026, 9, 5) },
      ],
      monthStart,
    );
    expect(rows[0].history).toEqual([0, 0, 0, 0, 0, 10]);
  });

  it("sums savings rows when asked for SAVINGS", () => {
    const rows = withSpendHistory(
      [{ id: "trip" }],
      [{ categoryId: "trip", type: "SAVINGS", amount: 200, date: new Date(2026, 8, 25) }],
      monthStart,
      "SAVINGS",
    );
    expect(rows[0].history).toEqual([0, 0, 0, 0, 200, 0]);
  });

  it("leaves a row with nothing spent in the window without a history", () => {
    const rows = withSpendHistory([{ id: "food", total: 0 }], [], monthStart);
    expect(rows[0]).toEqual({ id: "food", total: 0 });
    expect("history" in rows[0]).toBe(false);
  });

  it("crosses a year boundary", () => {
    const rows = withSpendHistory(
      [{ id: "food" }],
      [expense("food", 40, new Date(2025, 11, 31)), expense("food", 60, new Date(2026, 1, 1))],
      new Date(2026, 1, 1),
    );
    // Sep 2025 … Feb 2026
    expect(rows[0].history).toEqual([0, 0, 0, 40, 0, 60]);
  });
});

describe("vsUsual", () => {
  it("compares this month with the average of earlier months that had spending", () => {
    // Usual is (400 + 600) / 2 = 500; 590 is 18% more.
    expect(vsUsual([0, 0, 400, 0, 600, 590])).toEqual({ direction: "more", percent: 18 });
    expect(vsUsual([500, 500, 500, 250])).toEqual({ direction: "less", percent: 50 });
  });

  it("calls a change under 10% the same", () => {
    expect(vsUsual([500, 500, 530])).toEqual({ direction: "same", percent: 6 });
  });

  it("has nothing to say without earlier spending", () => {
    expect(vsUsual([0, 0, 0, 300])).toBeNull();
    expect(vsUsual([300])).toBeNull();
  });
});

describe("projectMonthEnd", () => {
  const monthStart = new Date(2026, 9, 1); // October: 31 days
  const tx = (amount: number, day: number, extra: Partial<ProjectionTransaction> = {}) => ({
    type: "EXPENSE" as const,
    amount,
    date: new Date(2026, 9, day),
    isRecurring: false,
    recurringTemplateId: null,
    ...extra,
  });

  it("projects today's figure forward at the month's daily pace", () => {
    const p = projectMonthEnd({
      safeToSpend: 1000,
      transactions: [tx(100, 2), tx(200, 9)],
      monthStart,
      today: new Date(2026, 9, 10, 15),
    });
    expect(p).not.toBeNull();
    expect(p!.daysInMonth).toBe(31);
    expect(p!.daysElapsed).toBe(10);
    expect(p!.dailyPace).toBe(30);
    expect(p!.start).toBe(1300);
    expect(p!.projected).toBe(1000 - 30 * 21);
    expect(p!.actual).toHaveLength(10);
    expect(p!.actual[0]).toBe(1300);
    expect(p!.actual[1]).toBe(1200);
    expect(p!.actual[9]).toBe(1000);
  });

  it("leaves bills (recurring items, ticked-recurring) and income out of the pace", () => {
    const p = projectMonthEnd({
      safeToSpend: 500,
      transactions: [
        tx(100, 1),
        tx(8000, 1, { recurringTemplateId: "rent" }),
        tx(300, 2, { isRecurring: true }),
        tx(9999, 3, { type: "INCOME" }),
        tx(9999, 3, { type: "SAVINGS" }),
      ],
      monthStart,
      today: new Date(2026, 9, 5),
    });
    expect(p!.dailyPace).toBe(20);
    expect(p!.start).toBe(600);
  });

  it("draws a transaction dated later this month as spent today", () => {
    const p = projectMonthEnd({
      safeToSpend: 100,
      transactions: [tx(50, 25)],
      monthStart,
      today: new Date(2026, 9, 2),
    });
    expect(p!.actual).toEqual([150, 100]);
  });

  it("returns null for a month other than the current one", () => {
    const args = { safeToSpend: 100, transactions: [tx(50, 2)], monthStart };
    expect(projectMonthEnd({ ...args, today: new Date(2026, 10, 2) })).toBeNull();
    expect(projectMonthEnd({ ...args, today: new Date(2025, 9, 2) })).toBeNull();
  });

  it("returns null with no day-to-day spending yet", () => {
    expect(
      projectMonthEnd({ safeToSpend: 100, transactions: [], monthStart, today: new Date(2026, 9, 2) }),
    ).toBeNull();
  });

  it("can project below zero", () => {
    const p = projectMonthEnd({
      safeToSpend: 100,
      transactions: [tx(310, 1)],
      monthStart,
      today: new Date(2026, 9, 1),
    });
    expect(p!.projected).toBeCloseTo(100 - 310 * 30);
  });
});

describe("countUpValue", () => {
  it("starts at from, lands exactly on to, and eases out between", () => {
    expect(countUpValue(0, 100, 0)).toBe(0);
    expect(countUpValue(0, 100, 1)).toBe(100);
    expect(countUpValue(0, 100, 0.5)).toBeCloseTo(87.5);
    expect(countUpValue(100, 0, 0.5)).toBeCloseTo(12.5);
  });

  it("clamps progress outside 0–1", () => {
    expect(countUpValue(10, 20, -1)).toBe(10);
    expect(countUpValue(10, 20, 2)).toBe(20);
  });
});

describe("barHeightPercent", () => {
  it("scales against the max with a 3% floor for anything above zero", () => {
    expect(barHeightPercent(50, 100)).toBe(50);
    expect(barHeightPercent(1, 1000)).toBe(3);
    expect(barHeightPercent(0, 100)).toBe(0);
    expect(barHeightPercent(10, 0)).toBe(0);
  });
});

describe("niceCeiling", () => {
  it("rounds up to a clean multiple of a power of ten", () => {
    expect(niceCeiling(27843)).toBe(30000);
    expect(niceCeiling(26000)).toBe(30000);
    expect(niceCeiling(19000)).toBe(20000);
    expect(niceCeiling(2100)).toBe(2500);
    expect(niceCeiling(1000)).toBe(1000);
    expect(niceCeiling(7.5)).toBe(8);
    expect(niceCeiling(0.3)).toBe(0.3);
    expect(niceCeiling(85000)).toBe(100000);
  });

  it("is 0 when there is nothing to scale", () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(-5)).toBe(0);
  });
});

describe("trimLeadingEmpty", () => {
  const g = (key: string, ...values: number[]) => ({ key, values });

  it("drops the empty months before the first one with data", () => {
    const groups = [g("may", 0, 0), g("jun", 0, 0), g("jul", 0, 5), g("aug", 0, 0), g("sep", 3, 1)];
    expect(trimLeadingEmpty(groups).map((x) => x.key)).toEqual(["jul", "aug", "sep"]);
  });

  it("keeps the last group when every one is empty", () => {
    expect(trimLeadingEmpty([g("a", 0), g("b", 0)]).map((x) => x.key)).toEqual(["b"]);
  });
});

describe("dailyAllowance", () => {
  const monthStart = new Date(2026, 9, 1); // October: 31 days

  it("spreads the amount over the days left, today included", () => {
    // 21 Oct: 21..31 is 11 days.
    const a = dailyAllowance({ safeToSpend: 1100, monthStart, today: new Date(2026, 9, 21) });
    expect(a).toEqual({ perDay: 100, daysLeft: 11 });
  });

  it("gives the whole amount to the last day", () => {
    const a = dailyAllowance({ safeToSpend: 250, monthStart, today: new Date(2026, 9, 31) });
    expect(a).toEqual({ perDay: 250, daysLeft: 1 });
  });

  it("counts every day on the first", () => {
    const a = dailyAllowance({ safeToSpend: 3100, monthStart, today: new Date(2026, 9, 1) });
    expect(a).toEqual({ perDay: 100, daysLeft: 31 });
  });

  it("knows a short month and a leap February", () => {
    const leap = new Date(2028, 1, 1);
    expect(dailyAllowance({ safeToSpend: 290, monthStart: leap, today: new Date(2028, 1, 20) })).toEqual({
      perDay: 29,
      daysLeft: 10,
    });
    const feb = new Date(2027, 1, 1);
    expect(dailyAllowance({ safeToSpend: 10, monthStart: feb, today: new Date(2027, 1, 28) })?.daysLeft).toBe(1);
  });

  it("is null when nothing is left to spend", () => {
    const today = new Date(2026, 9, 21);
    expect(dailyAllowance({ safeToSpend: 0, monthStart, today })).toBeNull();
    expect(dailyAllowance({ safeToSpend: -50, monthStart, today })).toBeNull();
    expect(dailyAllowance({ safeToSpend: 0.004, monthStart, today })).toBeNull();
    expect(dailyAllowance({ safeToSpend: -1, monthStart, today: new Date(2026, 9, 31) })).toBeNull();
  });

  it("is null for a non-finite amount", () => {
    expect(dailyAllowance({ safeToSpend: NaN, monthStart, today: new Date(2026, 9, 21) })).toBeNull();
    expect(dailyAllowance({ safeToSpend: Infinity, monthStart, today: new Date(2026, 9, 21) })).toBeNull();
  });

  it("keeps a small positive amount (half a cent or more)", () => {
    const a = dailyAllowance({ safeToSpend: 0.01, monthStart, today: new Date(2026, 9, 31) });
    expect(a).toEqual({ perDay: 0.01, daysLeft: 1 });
  });

  it("is null for a past or future month", () => {
    const today = new Date(2026, 9, 21);
    expect(dailyAllowance({ safeToSpend: 500, monthStart: new Date(2026, 8, 1), today })).toBeNull();
    expect(dailyAllowance({ safeToSpend: 500, monthStart: new Date(2026, 10, 1), today })).toBeNull();
    expect(dailyAllowance({ safeToSpend: 500, monthStart: new Date(2025, 9, 1), today })).toBeNull();
  });
});

describe("projectMonthEnd with limited categories (UX-138)", () => {
  const monthStart = new Date(2026, 9, 1);
  const tx = (categoryId: string, amount: number, day: number) => ({
    categoryId,
    type: "EXPENSE" as const,
    amount,
    date: new Date(2026, 9, day),
    isRecurring: false,
    recurringTemplateId: null,
  });

  it("leaves spending in limited categories out of the pace", () => {
    const p = projectMonthEnd({
      safeToSpend: 1000,
      transactions: [tx("food", 500, 2), tx("fun", 100, 3)],
      monthStart,
      today: new Date(2026, 9, 10),
      excludeCategoryIds: new Set(["food"]),
    });
    expect(p!.dailyPace).toBe(10);
    expect(p!.start).toBe(1100);
  });

  it("has nothing to project when all the spending is in limited categories", () => {
    expect(
      projectMonthEnd({
        safeToSpend: 1000,
        transactions: [tx("food", 500, 2)],
        monthStart,
        today: new Date(2026, 9, 10),
        excludeCategoryIds: new Set(["food"]),
      }),
    ).toBeNull();
  });
});

// UX-134: a budget period that is not a calendar month.
describe("projectMonthEnd and dailyAllowance over a payday period (UX-134)", () => {
  const monthStart = new Date(2026, 8, 25); // 25 Sep
  const monthEnd = new Date(2026, 9, 25); // to 24 Oct: 30 days

  it("counts the period's days, not the calendar month's", () => {
    const p = projectMonthEnd({
      safeToSpend: 1000,
      transactions: [
        { type: "EXPENSE", amount: 100, date: new Date(2026, 8, 26), isRecurring: false, recurringTemplateId: null },
        // Before the period: not part of its pace.
        { type: "EXPENSE", amount: 900, date: new Date(2026, 8, 20), isRecurring: false, recurringTemplateId: null },
      ],
      monthStart,
      monthEnd,
      today: new Date(2026, 9, 4, 12), // day 10 of the period
    });
    expect(p).not.toBeNull();
    expect(p!.daysInMonth).toBe(30);
    expect(p!.daysElapsed).toBe(10);
    expect(p!.dailyPace).toBe(10);
    expect(p!.start).toBe(1100);
    expect(p!.actual[1]).toBe(1000);
  });

  it("is null outside the period", () => {
    const args = { safeToSpend: 100, transactions: [], monthStart, monthEnd };
    expect(projectMonthEnd({ ...args, today: new Date(2026, 8, 24) })).toBeNull();
    expect(projectMonthEnd({ ...args, today: new Date(2026, 9, 25) })).toBeNull();
    expect(dailyAllowance({ safeToSpend: 100, monthStart, monthEnd, today: new Date(2026, 9, 25) })).toBeNull();
  });

  it("spreads the allowance over the days left in the period", () => {
    // 24 October is the last day: the whole amount is today's.
    expect(dailyAllowance({ safeToSpend: 90, monthStart, monthEnd, today: new Date(2026, 9, 24) })).toEqual({
      perDay: 90,
      daysLeft: 1,
    });
    expect(dailyAllowance({ safeToSpend: 300, monthStart, monthEnd, today: new Date(2026, 8, 25) })).toEqual({
      perDay: 10,
      daysLeft: 30,
    });
  });
});

describe("withSpendHistory over payday periods (UX-134)", () => {
  it("buckets by the month a period ends in", () => {
    const rows = withSpendHistory(
      [{ id: "food" }],
      [
        expense("food", 10, new Date(2026, 8, 24)), // September's period
        expense("food", 20, new Date(2026, 8, 25)), // October's
        expense("food", 30, new Date(2026, 9, 24)), // October's
      ],
      new Date(2026, 9, 1),
      "EXPENSE",
      3,
      25,
    );
    expect(rows[0].history).toEqual([0, 10, 50]);
  });
});

describe("withSpendHistory up to the same day (design review, Oct 2026)", () => {
  const transactions = [
    expense("food", 100, new Date(2026, 9, 5)), // this month, day 5
    expense("food", 40, new Date(2026, 9, 28)), // this month, dated later: still this month's
    expense("food", 60, new Date(2026, 8, 3)), // September, before day 12
    expense("food", 300, new Date(2026, 8, 13)), // September day 13: after "today's" day 12
    expense("food", 50, new Date(2026, 7, 12)), // August day 12: counted (today included)
  ];

  it("cuts earlier months at today's day of their period while the month runs", () => {
    const rows = withSpendHistory([{ id: "food" }], transactions, new Date(2026, 9, 1), "EXPENSE", 3, 1, new Date(2026, 9, 12));
    expect(rows[0].history).toEqual([50, 360, 140]);
    expect(rows[0].historySoFar).toEqual([50, 60, 140]);
  });

  it("compares whole months once the viewed month is over", () => {
    const rows = withSpendHistory([{ id: "food" }], transactions, new Date(2026, 9, 1), "EXPENSE", 3, 1, new Date(2026, 10, 2));
    expect(rows[0].historySoFar).toBeUndefined();
  });

  it("counts days from a payday period's start (UX-134)", () => {
    const rows = withSpendHistory(
      [{ id: "food" }],
      [
        expense("food", 10, new Date(2026, 8, 26)), // October's period, day 2
        expense("food", 20, new Date(2026, 7, 26)), // September's, day 2
        expense("food", 30, new Date(2026, 7, 28)), // September's, day 4: after today's day 2
      ],
      new Date(2026, 9, 1),
      "EXPENSE",
      2,
      25,
      new Date(2026, 8, 26),
    );
    expect(rows[0].history).toEqual([50, 10]);
    expect(rows[0].historySoFar).toEqual([20, 10]);
  });
});

describe("usualFor", () => {
  it("compares mid-month spending with earlier months up to the same day", () => {
    // Twelve days in: 140 against 50 and 60 by day 12 is well above usual,
    // though against whole months (50 and 360) it would read as "less".
    const row = { history: [50, 360, 140], historySoFar: [50, 60, 140] };
    expect(vsUsual(row.history)).toEqual({ direction: "less", percent: 32 });
    expect(usualFor(row)).toEqual({ direction: "more", percent: 155 });
  });

  it("falls back to whole months, and to nothing without a history", () => {
    expect(usualFor({ history: [500, 500, 250] })).toEqual({ direction: "less", percent: 50 });
    expect(usualFor({})).toBeNull();
  });
});
