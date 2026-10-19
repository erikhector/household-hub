import { describe, expect, it } from "vitest";
import { isOlderCompletedOneOff } from "./older-completed";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-19T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("isOlderCompletedOneOff", () => {
  it("is true for a one-off completed more than 7 days ago", () => {
    expect(isOlderCompletedOneOff({ completed: true, completedAt: ago(8), recurrenceIntervalDays: null }, now)).toBe(true);
  });

  it("is false at exactly 7 days and for anything more recent", () => {
    expect(isOlderCompletedOneOff({ completed: true, completedAt: ago(7), recurrenceIntervalDays: null }, now)).toBe(false);
    expect(isOlderCompletedOneOff({ completed: true, completedAt: ago(1), recurrenceIntervalDays: null }, now)).toBe(false);
  });

  it("never collapses a repeating task, however old its last completion", () => {
    expect(isOlderCompletedOneOff({ completed: true, completedAt: ago(30), recurrenceIntervalDays: 90 }, now)).toBe(false);
  });

  it("is false for an open task, even one with an old completedAt", () => {
    expect(isOlderCompletedOneOff({ completed: false, completedAt: ago(30), recurrenceIntervalDays: null }, now)).toBe(false);
    expect(isOlderCompletedOneOff({ completed: false, completedAt: null, recurrenceIntervalDays: null }, now)).toBe(false);
  });
});
