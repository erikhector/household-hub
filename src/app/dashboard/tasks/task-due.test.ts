import { describe, expect, it } from "vitest";
import {
  daysOverdue,
  formatDueDateInput,
  getTaskDueDay,
  getTaskUrgency,
  parseDueDateInput,
  sortByUrgency,
  todayDayNumber,
  type TaskDueFields,
} from "./task-due";

const NOW = new Date("2026-10-23T10:00:00Z");
const TODAY = todayDayNumber(NOW, "UTC");

const task = (overrides: Partial<TaskDueFields> = {}): TaskDueFields => ({
  completedAt: null,
  recurrenceIntervalDays: null,
  createdAt: new Date("2026-10-01T08:00:00Z"),
  recurrenceAnchorAt: null,
  dueDate: null,
  ...overrides,
});

describe("getTaskDueDay", () => {
  it("is null for a one-off with no date", () => {
    expect(getTaskDueDay(task())).toBeNull();
  });

  it("reads a one-off's date as its calendar day", () => {
    expect(getTaskDueDay(task({ dueDate: new Date("2026-10-23T00:00:00Z") }))).toBe(TODAY);
  });

  it("derives a repeating task's date from its last tick: done 8 days ago every 3 days is 5 days overdue", () => {
    const due = getTaskDueDay(
      task({ recurrenceIntervalDays: 3, completedAt: new Date("2026-10-15T09:00:00Z") }),
    );
    expect(due).toBe(TODAY - 5);
    expect(daysOverdue(due, TODAY)).toBe(5);
  });

  it("is due on the reopening day, never before it, for a daily chore ticked late in the evening", () => {
    const due = getTaskDueDay(task({ recurrenceIntervalDays: 1, completedAt: new Date("2026-10-22T23:40:00Z") }));
    expect(getTaskUrgency(due, TODAY)).toBe("today");
  });

  it("is due on the anchor day while a repeating task has never been ticked", () => {
    const anchor = new Date("2026-10-20T12:00:00Z");
    expect(getTaskDueDay(task({ recurrenceIntervalDays: 7, recurrenceAnchorAt: anchor }))).toBe(TODAY - 3);
  });

  it("falls back to createdAt without an anchor", () => {
    expect(getTaskDueDay(task({ recurrenceIntervalDays: 7 }))).toBe(todayDayNumber(new Date("2026-10-01T08:00:00Z")));
  });

  it("ignores a stale dueDate once the task repeats", () => {
    const due = getTaskDueDay(
      task({
        recurrenceIntervalDays: 3,
        completedAt: new Date("2026-10-22T09:00:00Z"),
        dueDate: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    expect(due).toBe(TODAY + 2);
  });

  it("uses the visitor's zone for the local day", () => {
    // 23:30 UTC on the 22nd is already the 23rd in Stockholm (UTC+2).
    const completedAt = new Date("2026-10-22T23:30:00Z");
    const fields = task({ recurrenceIntervalDays: 1, completedAt });
    expect(getTaskDueDay(fields, "Europe/Stockholm")).toBe(getTaskDueDay(fields, "UTC")! + 1);
  });
});

describe("getTaskUrgency and daysOverdue", () => {
  it("classifies a due day against today", () => {
    expect(getTaskUrgency(null, TODAY)).toBe("none");
    expect(getTaskUrgency(TODAY - 1, TODAY)).toBe("overdue");
    expect(getTaskUrgency(TODAY, TODAY)).toBe("today");
    expect(getTaskUrgency(TODAY + 1, TODAY)).toBe("later");
  });

  it("counts whole days past due, and 0 otherwise", () => {
    expect(daysOverdue(TODAY - 5, TODAY)).toBe(5);
    expect(daysOverdue(TODAY, TODAY)).toBe(0);
    expect(daysOverdue(TODAY + 3, TODAY)).toBe(0);
    expect(daysOverdue(null, TODAY)).toBe(0);
  });
});

describe("sortByUrgency", () => {
  it("puts overdue (longest first), then today, then later (soonest first), then undated", () => {
    const rows = [
      { id: "undated", dueDay: null },
      { id: "later-far", dueDay: TODAY + 9 },
      { id: "today", dueDay: TODAY },
      { id: "overdue-1", dueDay: TODAY - 1 },
      { id: "later-near", dueDay: TODAY + 2 },
      { id: "overdue-5", dueDay: TODAY - 5 },
    ];
    expect(sortByUrgency(rows, TODAY).map((r) => r.id)).toEqual([
      "overdue-5",
      "overdue-1",
      "today",
      "later-near",
      "later-far",
      "undated",
    ]);
  });

  it("keeps the incoming order for ties and does not mutate its input", () => {
    const rows = [
      { id: "a", dueDay: null },
      { id: "b", dueDay: null },
      { id: "c", dueDay: TODAY },
      { id: "d", dueDay: TODAY },
    ];
    const copy = [...rows];
    expect(sortByUrgency(rows, TODAY).map((r) => r.id)).toEqual(["c", "d", "a", "b"]);
    expect(rows).toEqual(copy);
  });
});

describe("due date form value", () => {
  it("round-trips a real date", () => {
    const date = parseDueDateInput("2026-10-23");
    expect(date?.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(formatDueDateInput(date!)).toBe("2026-10-23");
  });

  it("rejects text and dates that don't exist", () => {
    expect(parseDueDateInput("")).toBeNull();
    expect(parseDueDateInput("tomorrow")).toBeNull();
    expect(parseDueDateInput("2026-02-30")).toBeNull();
    expect(parseDueDateInput("2026-13-01")).toBeNull();
  });
});
