import { describe, expect, it } from "vitest";
import { computeAcornStash, type AcornCompletion } from "@/lib/tasks/acorn-stash";

// Friday 27 November 2026, midday in Stockholm (UTC+1 in winter). Its
// Monday-start week runs Mon 23 Nov 00:00 to Mon 30 Nov 00:00 local time.
const now = new Date("2026-11-27T11:00:00Z");
const zone = "Europe/Stockholm";

const tick = (memberId: string | null, iso: string, acorns = 1): AcornCompletion => ({
  memberId,
  completedAt: new Date(iso),
  acorns,
});

const stash = (memberIds: string[], completions: AcornCompletion[], timeZone = zone, at = now) =>
  computeAcornStash({ memberIds, completions, now: at, timeZone });

describe("computeAcornStash", () => {
  it("gives every current member a zero row when nobody has ticked anything", () => {
    expect(stash(["a", "b"], [])).toEqual([
      { memberId: "a", week: 0, allTime: 0, streak: 0, leader: false },
      { memberId: "b", week: 0, allTime: 0, streak: 0, leader: false },
    ]);
  });

  it("counts one acorn per completion, so a recurring task earns each time", () => {
    const [a] = stash(
      ["a"],
      [tick("a", "2026-11-24T08:00:00Z"), tick("a", "2026-11-25T08:00:00Z"), tick("a", "2026-11-25T18:00:00Z")],
    );
    expect(a.week).toBe(3);
    expect(a.allTime).toBe(3);
  });

  it("sums the stored acorns rather than counting rows", () => {
    const [a] = stash(["a"], [tick("a", "2026-11-24T08:00:00Z", 2), tick("a", "2026-11-25T08:00:00Z", 1)]);
    expect(a.week).toBe(3);
    expect(a.allTime).toBe(3);
  });

  it("counts the week from Monday 00:00 in the household's zone, not UTC", () => {
    const [a] = stash(
      ["a"],
      [
        // Sunday 22 Nov 23:30 in Stockholm: last week.
        tick("a", "2026-11-22T22:30:00Z"),
        // Monday 23 Nov 00:30 in Stockholm, still Sunday in UTC: this week.
        tick("a", "2026-11-22T23:30:00Z"),
      ],
    );
    expect(a.week).toBe(1);
    expect(a.allTime).toBe(2);
  });

  it("reads the same rows in UTC by UTC days", () => {
    const [a] = stash(["a"], [tick("a", "2026-11-22T22:30:00Z"), tick("a", "2026-11-22T23:30:00Z")], "UTC");
    expect(a.week).toBe(0);
    expect(a.allTime).toBe(2);
  });

  it("falls back to UTC for a zone Intl doesn't know", () => {
    const [a] = stash(["a"], [tick("a", "2026-11-22T23:30:00Z")], "Not/AZone");
    expect(a.week).toBe(0);
  });

  it("keeps all-time totals across earlier weeks and years", () => {
    const [a] = stash(["a"], [tick("a", "2025-03-01T10:00:00Z"), tick("a", "2026-10-01T10:00:00Z"), tick("a", "2026-11-26T10:00:00Z")]);
    expect(a.week).toBe(1);
    expect(a.allTime).toBe(3);
  });

  describe("streak", () => {
    it("counts consecutive local days ending today", () => {
      const [a] = stash(
        ["a"],
        [tick("a", "2026-11-25T09:00:00Z"), tick("a", "2026-11-26T09:00:00Z"), tick("a", "2026-11-27T09:00:00Z")],
      );
      expect(a.streak).toBe(3);
    });

    it("still counts a run that ended yesterday, so the morning doesn't read as a reset", () => {
      const [a] = stash(["a"], [tick("a", "2026-11-25T09:00:00Z"), tick("a", "2026-11-26T09:00:00Z")]);
      expect(a.streak).toBe(2);
    });

    it("is zero once the last tick was two days ago or more", () => {
      const [a] = stash(["a"], [tick("a", "2026-11-24T09:00:00Z"), tick("a", "2026-11-25T09:00:00Z")]);
      expect(a.streak).toBe(0);
    });

    it("counts a day once however many ticks it had, and stops at a gap", () => {
      const [a] = stash(
        ["a"],
        [
          tick("a", "2026-11-23T09:00:00Z"),
          // 24 Nov missing.
          tick("a", "2026-11-25T08:00:00Z"),
          tick("a", "2026-11-25T09:00:00Z"),
          tick("a", "2026-11-26T09:00:00Z"),
          tick("a", "2026-11-27T09:00:00Z"),
        ],
      );
      expect(a.streak).toBe(3);
    });

    it("runs across a week boundary", () => {
      const [a] = stash(
        ["a"],
        [tick("a", "2026-11-21T09:00:00Z"), tick("a", "2026-11-22T09:00:00Z"), tick("a", "2026-11-23T09:00:00Z")],
        zone,
        new Date("2026-11-23T20:00:00Z"),
      );
      expect(a.streak).toBe(3);
    });

    it("uses local days: 23:30 and 00:30 local are two different days", () => {
      // Thu 26 Nov 23:30 and Fri 27 Nov 00:30 in Stockholm.
      const [a] = stash(["a"], [tick("a", "2026-11-26T22:30:00Z"), tick("a", "2026-11-26T23:30:00Z")]);
      expect(a.streak).toBe(2);
      // In UTC the same two ticks fall on one day.
      const [utc] = stash(["a"], [tick("a", "2026-11-26T22:30:00Z"), tick("a", "2026-11-26T23:30:00Z")], "UTC");
      expect(utc.streak).toBe(1);
    });

    it("counts across a DST change", () => {
      // Sat 24 Oct to Mon 26 Oct 2026; clocks go back on Sun 25 Oct in Stockholm.
      const [a] = stash(
        ["a"],
        [tick("a", "2026-10-24T21:30:00Z"), tick("a", "2026-10-25T22:30:00Z"), tick("a", "2026-10-26T09:00:00Z")],
        zone,
        new Date("2026-10-26T12:00:00Z"),
      );
      expect(a.streak).toBe(3);
    });
  });

  describe("members", () => {
    it("keeps the given member order, never sorting by pile size", () => {
      const result = stash(["a", "b"], [tick("b", "2026-11-24T09:00:00Z"), tick("b", "2026-11-25T09:00:00Z")]);
      expect(result.map((m) => m.memberId)).toEqual(["a", "b"]);
    });

    it("leaves out completions by members who left (null or no longer listed)", () => {
      const result = stash(
        ["a"],
        [tick(null, "2026-11-24T09:00:00Z"), tick("gone", "2026-11-24T09:00:00Z"), tick("a", "2026-11-24T09:00:00Z")],
      );
      expect(result).toEqual([{ memberId: "a", week: 1, allTime: 1, streak: 0, leader: true }]);
    });
  });

  describe("leader", () => {
    it("marks whoever has this week's biggest pile", () => {
      const result = stash(
        ["a", "b"],
        [tick("a", "2026-11-24T09:00:00Z"), tick("b", "2026-11-24T09:00:00Z"), tick("b", "2026-11-25T09:00:00Z")],
      );
      expect(result.map((m) => m.leader)).toEqual([false, true]);
    });

    it("marks everyone tied for the top", () => {
      const result = stash(["a", "b", "c"], [tick("a", "2026-11-24T09:00:00Z"), tick("b", "2026-11-25T09:00:00Z")]);
      expect(result.map((m) => m.leader)).toEqual([true, true, false]);
    });

    it("marks nobody in a week with no acorns, whatever last week held", () => {
      const result = stash(["a", "b"], [tick("a", "2026-11-18T09:00:00Z"), tick("a", "2026-11-19T09:00:00Z")]);
      expect(result.map((m) => m.leader)).toEqual([false, false]);
    });

    it("goes by this week, not all time", () => {
      const result = stash(
        ["a", "b"],
        [tick("a", "2026-10-01T09:00:00Z"), tick("a", "2026-10-02T09:00:00Z"), tick("b", "2026-11-26T09:00:00Z")],
      );
      expect(result.map((m) => m.leader)).toEqual([false, true]);
    });
  });
});
