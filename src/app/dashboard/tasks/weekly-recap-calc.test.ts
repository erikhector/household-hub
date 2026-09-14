import { describe, expect, it } from "vitest";
import { computeWeeklyTaskRecap, type WeeklyRecapTask } from "@/app/dashboard/tasks/weekly-recap-calc";

// Wednesday, Sept 16 2026 — week runs Mon Sept 14 (UTC midnight) through
// Mon Sept 21 (exclusive), matching getWeekStart's Monday-start convention.
const now = new Date(Date.UTC(2026, 8, 16, 12, 0, 0));

describe("computeWeeklyTaskRecap", () => {
  it("groups tasks completed within the current Monday-start week by completer", () => {
    const tasks: WeeklyRecapTask[] = [
      { title: "Bins", completedAt: new Date(Date.UTC(2026, 8, 14, 8, 0, 0)), completedByMemberId: "member-a" },
      { title: "Dishwasher", completedAt: new Date(Date.UTC(2026, 8, 15, 8, 0, 0)), completedByMemberId: "member-a" },
      { title: "Plants", completedAt: new Date(Date.UTC(2026, 8, 16, 8, 0, 0)), completedByMemberId: "member-b" },
    ];
    expect(computeWeeklyTaskRecap({ tasks, now })).toEqual([
      { completedByMemberId: "member-a", titles: ["Bins", "Dishwasher"] },
      { completedByMemberId: "member-b", titles: ["Plants"] },
    ]);
  });

  it("orders groups by first appearance, never by how many tasks a group has", () => {
    const tasks: WeeklyRecapTask[] = [
      { title: "Plants", completedAt: new Date(Date.UTC(2026, 8, 14, 8, 0, 0)), completedByMemberId: "member-b" },
      { title: "Bins", completedAt: new Date(Date.UTC(2026, 8, 15, 8, 0, 0)), completedByMemberId: "member-a" },
      { title: "Dishwasher", completedAt: new Date(Date.UTC(2026, 8, 16, 8, 0, 0)), completedByMemberId: "member-a" },
    ];
    // member-b appears first even though member-a ends up with more tasks —
    // a count-sorted result would put member-a first instead.
    expect(computeWeeklyTaskRecap({ tasks, now }).map((g) => g.completedByMemberId)).toEqual([
      "member-b",
      "member-a",
    ]);
  });

  it("excludes tasks completed before the current week", () => {
    const tasks: WeeklyRecapTask[] = [
      { title: "Old task", completedAt: new Date(Date.UTC(2026, 8, 13, 23, 59, 0)), completedByMemberId: "member-a" },
    ];
    expect(computeWeeklyTaskRecap({ tasks, now })).toEqual([]);
  });

  it("excludes tasks completed on or after next week's start", () => {
    const tasks: WeeklyRecapTask[] = [
      { title: "Future task", completedAt: new Date(Date.UTC(2026, 8, 21, 0, 0, 0)), completedByMemberId: "member-a" },
    ];
    expect(computeWeeklyTaskRecap({ tasks, now })).toEqual([]);
  });

  it("excludes tasks that aren't completed", () => {
    const tasks: WeeklyRecapTask[] = [{ title: "Open task", completedAt: null, completedByMemberId: null }];
    expect(computeWeeklyTaskRecap({ tasks, now })).toEqual([]);
  });

  it("groups an unattributed completion (completer left the household) under null", () => {
    const tasks: WeeklyRecapTask[] = [
      { title: "Bins", completedAt: new Date(Date.UTC(2026, 8, 15, 8, 0, 0)), completedByMemberId: null },
    ];
    expect(computeWeeklyTaskRecap({ tasks, now })).toEqual([{ completedByMemberId: null, titles: ["Bins"] }]);
  });

  it("returns an empty array for a quiet week rather than treating it specially", () => {
    expect(computeWeeklyTaskRecap({ tasks: [], now })).toEqual([]);
  });
});
