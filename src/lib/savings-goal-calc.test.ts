import { describe, expect, it } from "vitest";
import {
  computeSavingsGoalProgress,
  goalAmountField,
  goalDateField,
  goalForType,
  savingsGoalRows,
} from "@/lib/savings-goal-calc";

// Local-time "today" (the budget pages' convention) and UTC-midnight goal
// dates (how goalDateField stores the picked day).
const today = new Date(2026, 8, 25, 14, 30); // 25 Sep 2026, afternoon
const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("goalAmountField", () => {
  it("treats an empty, blank or missing field as 'no goal'", () => {
    expect(goalAmountField.parse("")).toBeNull();
    expect(goalAmountField.parse("  ")).toBeNull();
    expect(goalAmountField.parse(null)).toBeNull();
    expect(goalAmountField.parse(undefined)).toBeNull();
  });

  it("parses a positive amount", () => {
    expect(goalAmountField.parse("25000")).toBe(25000);
    expect(goalAmountField.parse(" 1500.50 ")).toBe(1500.5);
  });

  it("rejects zero, negative and non-numeric amounts", () => {
    expect(goalAmountField.safeParse("0").success).toBe(false);
    expect(goalAmountField.safeParse("-10").success).toBe(false);
    expect(goalAmountField.safeParse("lots").success).toBe(false);
  });
});

describe("goalDateField", () => {
  it("treats an empty, blank or missing field as 'no date'", () => {
    expect(goalDateField.parse("")).toBeNull();
    expect(goalDateField.parse(" ")).toBeNull();
    expect(goalDateField.parse(null)).toBeNull();
    expect(goalDateField.parse(undefined)).toBeNull();
  });

  it("parses a date input's value to UTC midnight of that day", () => {
    const parsed = goalDateField.parse("2026-12-31");
    expect(parsed).toEqual(utcDay(2026, 12, 31));
    // Round-trips through the edit form's default value.
    expect((parsed as Date).toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("accepts a date in the past, so an unrelated edit still saves", () => {
    expect(goalDateField.parse("2020-01-01")).toEqual(utcDay(2020, 1, 1));
  });

  it("rejects malformed and impossible dates", () => {
    expect(goalDateField.safeParse("31/12/2026").success).toBe(false);
    expect(goalDateField.safeParse("2026-02-31").success).toBe(false);
    expect(goalDateField.safeParse("2026-13-01").success).toBe(false);
    expect(goalDateField.safeParse("soon").success).toBe(false);
  });
});

describe("goalForType", () => {
  const date = utcDay(2026, 12, 31);

  it("keeps the goal on a SAVINGS category", () => {
    expect(goalForType("SAVINGS", 5000, date)).toEqual({ goalAmount: 5000, goalDate: date });
    expect(goalForType("SAVINGS", 5000, null)).toEqual({ goalAmount: 5000, goalDate: null });
  });

  it("clears both fields on income and expense categories", () => {
    expect(goalForType("EXPENSE", 5000, date)).toEqual({ goalAmount: null, goalDate: null });
    expect(goalForType("INCOME", 5000, date)).toEqual({ goalAmount: null, goalDate: null });
  });

  it("drops a date that has no amount to go with it", () => {
    expect(goalForType("SAVINGS", null, date)).toEqual({ goalAmount: null, goalDate: null });
  });
});

describe("computeSavingsGoalProgress", () => {
  it("returns null without a usable goal amount", () => {
    expect(computeSavingsGoalProgress({ saved: 100, goalAmount: null, goalDate: null, today })).toBeNull();
    expect(computeSavingsGoalProgress({ saved: 100, goalAmount: undefined, goalDate: null, today })).toBeNull();
    expect(computeSavingsGoalProgress({ saved: 100, goalAmount: 0, goalDate: null, today })).toBeNull();
    expect(computeSavingsGoalProgress({ saved: 100, goalAmount: -5, goalDate: null, today })).toBeNull();
    expect(computeSavingsGoalProgress({ saved: 100, goalAmount: NaN, goalDate: null, today })).toBeNull();
  });

  it("shows progress but no monthly pace when there's no date", () => {
    expect(computeSavingsGoalProgress({ saved: 2500, goalAmount: 10000, goalDate: null, today })).toEqual({
      status: "noDate",
      saved: 2500,
      goal: 10000,
      remaining: 7500,
      percent: 25,
      fillPercent: 25,
      monthsLeft: null,
      perMonth: null,
    });
  });

  it("spreads what's left over the months through the goal's, counting this one", () => {
    // Sep, Oct, Nov, Dec → 4 months for 8,000 left.
    const progress = computeSavingsGoalProgress({
      saved: 2000,
      goalAmount: 10000,
      goalDate: utcDay(2026, 12, 31),
      today,
    });
    expect(progress).toMatchObject({ status: "inProgress", remaining: 8000, monthsLeft: 4, perMonth: 2000 });
  });

  it("only counts calendar months, not the day within them", () => {
    // 1 Dec and 31 Dec both leave Sep–Dec.
    const early = computeSavingsGoalProgress({ saved: 0, goalAmount: 400, goalDate: utcDay(2026, 12, 1), today });
    expect(early).toMatchObject({ monthsLeft: 4, perMonth: 100 });
  });

  it("crosses a year boundary", () => {
    const progress = computeSavingsGoalProgress({
      saved: 0,
      goalAmount: 1200,
      goalDate: utcDay(2027, 8, 15),
      today,
    });
    // Sep 2026 through Aug 2027 inclusive.
    expect(progress).toMatchObject({ monthsLeft: 12, perMonth: 100 });
  });

  it("asks for the whole remainder when no months are left after this one", () => {
    const progress = computeSavingsGoalProgress({
      saved: 700,
      goalAmount: 1000,
      goalDate: utcDay(2026, 9, 30),
      today,
    });
    expect(progress).toMatchObject({ status: "inProgress", monthsLeft: 1, perMonth: 300, remaining: 300 });
  });

  it("still counts a goal dated today as in progress", () => {
    const progress = computeSavingsGoalProgress({
      saved: 0,
      goalAmount: 50,
      goalDate: utcDay(2026, 9, 25),
      today,
    });
    expect(progress).toMatchObject({ status: "inProgress", monthsLeft: 1, perMonth: 50 });
  });

  it("stops suggesting a pace once the date has passed", () => {
    const progress = computeSavingsGoalProgress({
      saved: 600,
      goalAmount: 1000,
      goalDate: utcDay(2026, 9, 24),
      today,
    });
    expect(progress).toEqual({
      status: "datePassed",
      saved: 600,
      goal: 1000,
      remaining: 400,
      percent: 60,
      fillPercent: 60,
      monthsLeft: null,
      perMonth: null,
    });
  });

  it("marks a goal reached — date or not — with nothing left", () => {
    const withDate = computeSavingsGoalProgress({
      saved: 1000,
      goalAmount: 1000,
      goalDate: utcDay(2026, 12, 31),
      today,
    });
    expect(withDate).toMatchObject({ status: "reached", remaining: 0, perMonth: null, fillPercent: 100 });
    // Reached beats a passed date: the goal was met, the date doesn't matter.
    const late = computeSavingsGoalProgress({ saved: 1000, goalAmount: 1000, goalDate: utcDay(2020, 1, 1), today });
    expect(late?.status).toBe("reached");
  });

  it("keeps the unclamped percentage past the goal but caps the bar", () => {
    const progress = computeSavingsGoalProgress({ saved: 1500, goalAmount: 1000, goalDate: null, today });
    expect(progress).toMatchObject({ status: "reached", percent: 150, fillPercent: 100, remaining: 0 });
  });

  it("treats float noise just short of the goal as reached", () => {
    const progress = computeSavingsGoalProgress({ saved: 999.999, goalAmount: 1000, goalDate: null, today });
    expect(progress?.status).toBe("reached");
  });

  it("floors a net withdrawal at zero saved", () => {
    const progress = computeSavingsGoalProgress({ saved: -200, goalAmount: 1000, goalDate: null, today });
    expect(progress).toMatchObject({ saved: 0, remaining: 1000, percent: 0, fillPercent: 0 });
  });
});

describe("savingsGoalRows", () => {
  it("keeps only SAVINGS categories with a goal, in order, with their saved totals", () => {
    const rows = savingsGoalRows(
      [
        { id: "a", name: "Holiday", type: "SAVINGS", goalAmount: 2000, goalDate: null },
        { id: "b", name: "Buffer", type: "SAVINGS", goalAmount: null, goalDate: null },
        { id: "c", name: "Food", type: "EXPENSE", goalAmount: 500, goalDate: null },
        { id: "d", name: "Car", type: "SAVINGS", goalAmount: 1000, goalDate: utcDay(2026, 10, 1) },
      ],
      new Map([["a", 500]]),
      today,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "d"]);
    expect(rows[0].progress.saved).toBe(500);
    // Nothing logged against "d" yet: all of it is still to go.
    expect(rows[1].progress).toMatchObject({ saved: 0, remaining: 1000, monthsLeft: 2, perMonth: 500 });
    expect(rows[1].goalDate).toEqual(utcDay(2026, 10, 1));
  });
});
