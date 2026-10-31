import { describe, expect, it } from "vitest";
import {
  canShuffle,
  habitWeekday,
  pickFreshness,
  suggestSpread,
  weekdayOf,
  type SpreadPick,
  type Weekday,
} from "@/lib/week-picks-spread";

const pick = (id: string, extra: Partial<SpreadPick> = {}): SpreadPick => ({
  id,
  habitWeekday: null,
  freshness: null,
  ...extra,
});

const ALL: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

describe("suggestSpread", () => {
  it("fills free dinners in pick order when nothing else is known", () => {
    const { rows, unplaced } = suggestSpread([pick("a"), pick("b")], [1, 3]);
    expect(rows).toEqual([
      { pickId: "a", weekday: 1, reason: { kind: "order" } },
      { pickId: "b", weekday: 3, reason: { kind: "order" } },
    ]);
    expect(unplaced).toBe(0);
  });

  it("puts a recipe on its habit weekday first, when that dinner is free", () => {
    const { rows } = suggestSpread([pick("a"), pick("soup", { habitWeekday: 3 })], ALL);
    expect(rows.find((r) => r.pickId === "soup")).toEqual({
      pickId: "soup",
      weekday: 3,
      reason: { kind: "habit", weekday: 3 },
    });
    expect(rows.find((r) => r.pickId === "a")?.weekday).toBe(0);
  });

  it("falls back to the other rules when the habit day is taken", () => {
    const { rows } = suggestSpread([pick("soup", { habitWeekday: 3 })], [0, 1]);
    expect(rows).toEqual([{ pickId: "soup", weekday: 0, reason: { kind: "order" } }]);
  });

  it("gives a habit day to the first pick only", () => {
    const { rows } = suggestSpread(
      [pick("a", { habitWeekday: 4 }), pick("b", { habitWeekday: 4 })],
      [2, 4],
    );
    expect(rows).toEqual([
      { pickId: "b", weekday: 2, reason: { kind: "order" } },
      { pickId: "a", weekday: 4, reason: { kind: "habit", weekday: 4 } },
    ]);
  });

  it("puts the most perishable picks on the earliest free dinners", () => {
    const { rows } = suggestSpread(
      [
        pick("bolognese"),
        pick("curry", { freshness: { days: 3, item: "Chicken" } }),
        pick("salmon", { freshness: { days: 1, item: "Salmon" } }),
      ],
      [0, 2, 4],
    );
    expect(rows).toEqual([
      { pickId: "salmon", weekday: 0, reason: { kind: "fresh", item: "Salmon" } },
      { pickId: "curry", weekday: 2, reason: { kind: "fresh", item: "Chicken" } },
      { pickId: "bolognese", weekday: 4, reason: { kind: "order" } },
    ]);
  });

  it("ignores ingredients that keep longer than the perishable threshold", () => {
    const { rows } = suggestSpread([pick("a"), pick("b", { freshness: { days: 5, item: "Onion" } })], [0, 1]);
    expect(rows.map((r) => r.pickId)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.reason.kind === "order")).toBe(true);
  });

  it("counts the picks that didn't fit", () => {
    const { rows, unplaced } = suggestSpread([pick("a"), pick("b"), pick("c")], [5]);
    expect(rows).toHaveLength(1);
    expect(unplaced).toBe(2);
  });

  it("places nothing without a free dinner", () => {
    expect(suggestSpread([pick("a")], [])).toEqual({ rows: [], unplaced: 1 });
  });

  it("rotates only the pick-order rows on shuffle", () => {
    const picks = [pick("a"), pick("b"), pick("c"), pick("fish", { freshness: { days: 0, item: "Cod" } })];
    const first = suggestSpread(picks, [0, 1, 2, 3], 0).rows.map((r) => r.pickId);
    const second = suggestSpread(picks, [0, 1, 2, 3], 1).rows.map((r) => r.pickId);
    expect(first).toEqual(["fish", "a", "b", "c"]);
    expect(second).toEqual(["fish", "b", "c", "a"]);
    // A full turn comes back round.
    expect(suggestSpread(picks, [0, 1, 2, 3], 3).rows.map((r) => r.pickId)).toEqual(first);
  });

  it("says when shuffle can change anything", () => {
    expect(canShuffle([pick("a"), pick("b")], [0, 1])).toBe(true);
    expect(canShuffle([pick("a"), pick("b")], [0])).toBe(false);
    expect(canShuffle([pick("a", { habitWeekday: 0 }), pick("b")], [0, 1])).toBe(false);
  });
});

describe("habitWeekday", () => {
  // 2026-10-01 is a Thursday.
  it("finds the weekday a recipe is usually cooked on", () => {
    expect(habitWeekday(["2026-10-01", "2026-10-08", "2026-10-13"])).toBe(3);
  });

  it("needs at least two cooks on the same weekday", () => {
    expect(habitWeekday(["2026-10-01"])).toBeNull();
    expect(habitWeekday(["2026-10-01", "2026-10-02"])).toBeNull();
  });

  it("needs that weekday for at least half the cooks", () => {
    expect(habitWeekday(["2026-10-01", "2026-10-08", "2026-10-05", "2026-10-06", "2026-10-10"])).toBeNull();
  });

  it("calls a tie no habit", () => {
    expect(habitWeekday(["2026-10-01", "2026-10-08", "2026-10-02", "2026-10-09"])).toBeNull();
  });
});

describe("weekdayOf", () => {
  it("is Monday-first and reads the key in UTC", () => {
    expect(weekdayOf("2026-11-02")).toBe(0);
    expect(weekdayOf("2026-11-08")).toBe(6);
    expect(weekdayOf("nope")).toBeNull();
  });
});

describe("pickFreshness", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const item = (over: Partial<NonNullable<Parameters<typeof pickFreshness>[0][number]["item"]>>) => ({
    name: "Item",
    quantity: 0,
    expiresAt: null,
    shelfLifeDays: null,
    ...over,
  });

  it("uses the days left on an in-stock item's expiry date", () => {
    expect(
      pickFreshness([{ name: "milk", item: item({ name: "Milk", quantity: 1, expiresAt: new Date("2026-11-04T12:00:00Z") }) }], now),
    ).toEqual({ days: 2, item: "Milk" });
  });

  it("never goes below zero for something already past its date", () => {
    expect(
      pickFreshness([{ name: "x", item: item({ name: "Cream", quantity: 1, expiresAt: new Date("2026-10-30T00:00:00Z") }) }], now),
    ).toEqual({ days: 0, item: "Cream" });
  });

  it("uses the shelf life of something that will be bought", () => {
    expect(pickFreshness([{ name: "salmon", item: item({ name: "Salmon", shelfLifeDays: 2 }) }], now)).toEqual({
      days: 2,
      item: "Salmon",
    });
  });

  it("returns the shortest-lived ingredient", () => {
    expect(
      pickFreshness(
        [
          { name: "a", item: item({ name: "Potatoes", shelfLifeDays: 5 }) },
          { name: "b", item: item({ name: "Dill", shelfLifeDays: 3 }) },
        ],
        now,
      ),
    ).toEqual({ days: 3, item: "Dill" });
  });

  it("says nothing for unlinked, never-expiring or unknown ingredients", () => {
    expect(
      pickFreshness(
        [
          { name: "salt", item: null },
          { name: "rice", item: item({ shelfLifeDays: -1 }) },
          { name: "beans", item: item({ quantity: 2 }) },
        ],
        now,
      ),
    ).toBeNull();
  });
});
