import { describe, expect, it } from "vitest";
import {
  barHeightPercent,
  countUpValue,
  historyMonthLabels,
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

describe("historyMonthLabels", () => {
  it("names the window's months oldest first, ending at the viewed month", () => {
    expect(historyMonthLabels(new Date(2026, 1, 1), "en")).toEqual([
      "Sep",
      "Oct",
      "Nov",
      "Dec",
      "Jan",
      "Feb",
    ]);
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
