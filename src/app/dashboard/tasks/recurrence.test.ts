import { describe, expect, it } from "vitest";
import { isTaskOpen } from "@/app/dashboard/tasks/recurrence";

const now = new Date("2026-09-14T12:00:00.000Z");

describe("isTaskOpen", () => {
  it("is open when never completed, recurring or not", () => {
    expect(isTaskOpen({ completedAt: null, recurrenceIntervalDays: null }, now)).toBe(true);
    expect(isTaskOpen({ completedAt: null, recurrenceIntervalDays: 3 }, now)).toBe(true);
  });

  it("stays completed (not open) for a non-recurring task, however long ago it was completed", () => {
    const completedAt = new Date("2020-01-01T00:00:00.000Z");
    expect(isTaskOpen({ completedAt, recurrenceIntervalDays: null }, now)).toBe(false);
  });

  it("stays completed for a recurring task before its interval has elapsed", () => {
    const completedAt = new Date("2026-09-13T12:00:00.000Z"); // 1 day ago
    expect(isTaskOpen({ completedAt, recurrenceIntervalDays: 3 }, now)).toBe(false);
  });

  it("is open again for a recurring task exactly at the interval boundary", () => {
    const completedAt = new Date("2026-09-11T12:00:00.000Z"); // exactly 3 days ago
    expect(isTaskOpen({ completedAt, recurrenceIntervalDays: 3 }, now)).toBe(true);
  });

  it("is open again for a recurring task well past its interval", () => {
    const completedAt = new Date("2026-09-01T12:00:00.000Z");
    expect(isTaskOpen({ completedAt, recurrenceIntervalDays: 3 }, now)).toBe(true);
  });
});
