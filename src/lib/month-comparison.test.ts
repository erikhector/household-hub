import { describe, expect, it } from "vitest";
import { amountChangeOf, changeOf, previousCutoff, standOuts, totalsOf } from "@/lib/month-comparison";

describe("totalsOf", () => {
  it("sums each type and what's left of the income", () => {
    expect(
      totalsOf([
        { type: "INCOME", amount: 1000 },
        { type: "EXPENSE", amount: 300 },
        { type: "EXPENSE", amount: 200 },
        { type: "SAVINGS", amount: 100 },
      ]),
    ).toEqual({ income: 1000, expense: 500, savings: 100, left: 400 });
  });
});

describe("previousCutoff", () => {
  const current = { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) };
  const previous = { start: new Date(2026, 8, 1), end: new Date(2026, 9, 1) };

  it("cuts last month at the same day while this one is running", () => {
    // 12 Oct: twelve days so far, so 1–12 Sep.
    expect(previousCutoff({ current, previous, today: new Date(2026, 9, 12, 15) })).toEqual({
      end: new Date(2026, 8, 13),
      partial: true,
    });
  });

  it("compares a finished month with the whole previous one", () => {
    expect(previousCutoff({ current, previous, today: new Date(2026, 10, 4) })).toEqual({
      end: previous.end,
      partial: false,
    });
  });

  it("uses the whole previous month on the current month's last day", () => {
    // 31 days so far against a 30-day September.
    expect(previousCutoff({ current, previous, today: new Date(2026, 9, 31, 9) })).toEqual({
      end: previous.end,
      partial: false,
    });
  });
});

describe("changeOf", () => {
  it("gives the change in whole percent", () => {
    expect(changeOf(1180, 1000)).toEqual({ direction: "more", percent: 18 });
    expect(changeOf(500, 1000)).toEqual({ direction: "less", percent: 50 });
  });

  it("calls a change under 5% the same", () => {
    expect(changeOf(1030, 1000)).toEqual({ direction: "same", percent: 3 });
    expect(changeOf(0, 0)).toEqual({ direction: "same", percent: 0 });
  });

  it("calls something from nothing new", () => {
    expect(changeOf(200, 0)).toEqual({ direction: "new", percent: 0 });
  });

  it("measures a negative previous value by its size", () => {
    // Left over went from −200 to 100: up by 150% of 200.
    expect(changeOf(100, -200)).toEqual({ direction: "more", percent: 150 });
  });
});

describe("standOuts", () => {
  const row = (name: string, history: number[]) => ({ id: name, name, total: history[history.length - 1], history });

  it("picks the biggest rise and the biggest fall against usual, biggest first", () => {
    expect(
      standOuts([
        row("Groceries", [500, 500, 565]), // +13%
        row("Fun", [100, 100, 160]), // +60%
        row("Eating out", [400, 400, 240]), // −40%
        row("Rent", [1000, 1000, 1000]), // same
      ]),
    ).toEqual([
      { name: "Fun", direction: "more", percent: 60 },
      { name: "Eating out", direction: "less", percent: 40 },
    ]);
  });

  it("is empty with nothing to compare", () => {
    expect(standOuts([{ name: "A" }])).toEqual([]);
  });

  it("compares a running month up to the same day", () => {
    // Whole months say Groceries is down 50%; by the same day it's up 100%.
    expect(standOuts([{ name: "Groceries", history: [400, 400, 200], historySoFar: [100, 100, 200] }])).toEqual([
      { name: "Groceries", direction: "more", percent: 100 },
    ]);
  });
});

describe("amountChangeOf", () => {
  it("gives the change as an amount, never a percentage that blows up", () => {
    // 100 → 5 000 was "4900% more" as a percentage.
    expect(amountChangeOf(5000, 100)).toEqual({ direction: "more", amount: 4900 });
    expect(amountChangeOf(-200, 1000)).toEqual({ direction: "less", amount: 1200 });
    expect(amountChangeOf(100, -200)).toEqual({ direction: "more", amount: 300 });
  });

  it("calls a change within 5% of the larger amount the same", () => {
    expect(amountChangeOf(1030, 1000)).toEqual({ direction: "same", amount: 30 });
    expect(amountChangeOf(0, 0)).toEqual({ direction: "same", amount: 0 });
  });
});
