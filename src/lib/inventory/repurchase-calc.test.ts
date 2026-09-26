import { describe, expect, it } from "vitest";
import {
  DUE_FRACTION,
  MAX_REPURCHASE_SUGGESTIONS,
  MIN_PURCHASES,
  getRepurchaseSuggestions,
  purchaseTimestamp,
  repurchaseRhythm,
  repurchaseSnoozeUntil,
  type RepurchaseCandidate,
} from "./repurchase-calc";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-26T12:00:00Z");

// Noon UTC `daysAgo` days before NOW, so day arithmetic is unambiguous.
function daysAgo(days: number, hour = 12): Date {
  const date = new Date(NOW.getTime() - days * DAY_MS);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

function candidate(overrides: Partial<RepurchaseCandidate> & { purchases: Date[] }): RepurchaseCandidate {
  return { inventoryItemId: "coffee", name: "Coffee", snoozedUntil: null, ...overrides };
}

describe("purchaseTimestamp", () => {
  const checked = new Date("2026-09-01T10:00:00Z");
  const completed = new Date("2026-09-01T18:00:00Z");

  it("prefers the hand tick's checkedOffAt", () => {
    expect(purchaseTimestamp({ purchased: true, checkedOffAt: checked, listCompletedAt: completed })).toBe(checked);
  });

  it("falls back to the list's completedAt for receipt-applied rows", () => {
    expect(purchaseTimestamp({ purchased: true, checkedOffAt: null, listCompletedAt: completed })).toBe(completed);
  });

  it("has no date for a receipt-applied row on a list that isn't completed yet", () => {
    expect(purchaseTimestamp({ purchased: true, checkedOffAt: null, listCompletedAt: null })).toBeNull();
  });

  it("ignores rows that weren't bought, whatever timestamps they carry", () => {
    expect(purchaseTimestamp({ purchased: false, checkedOffAt: checked, listCompletedAt: completed })).toBeNull();
  });
});

describe("repurchaseRhythm", () => {
  it("takes the median interval between purchases", () => {
    // Intervals 10, 12, 14 → median 12.
    const rhythm = repurchaseRhythm([daysAgo(36), daysAgo(26), daysAgo(14), daysAgo(0)]);
    expect(rhythm).toEqual({ medianIntervalDays: 12, lastPurchasedAt: daysAgo(0), purchaseCount: 4 });
  });

  it("averages the two middle intervals for an even count", () => {
    // Intervals 7, 9 → 8.
    expect(repurchaseRhythm([daysAgo(16), daysAgo(9), daysAgo(0)])?.medianIntervalDays).toBe(8);
  });

  it("is not skewed by one long gap the way a mean would be", () => {
    // Intervals 7, 7, 30, 7 → median 7 (mean would be 12.75).
    const rhythm = repurchaseRhythm([daysAgo(51), daysAgo(44), daysAgo(37), daysAgo(7), daysAgo(0)]);
    expect(rhythm?.medianIntervalDays).toBe(7);
  });

  it("doesn't care about input order", () => {
    expect(repurchaseRhythm([daysAgo(0), daysAgo(20), daysAgo(10)])?.medianIntervalDays).toBe(10);
  });

  it(`needs at least ${MIN_PURCHASES} purchases`, () => {
    expect(MIN_PURCHASES).toBe(3);
    expect(repurchaseRhythm([])).toBeNull();
    expect(repurchaseRhythm([daysAgo(10), daysAgo(0)])).toBeNull();
    expect(repurchaseRhythm([daysAgo(20), daysAgo(10), daysAgo(0)])).not.toBeNull();
  });

  it("collapses purchases on the same day into one", () => {
    // Two lines on one shop day, then two more shops — only 3 distinct days,
    // and no 0-day interval dragging the median down.
    const rhythm = repurchaseRhythm([daysAgo(20, 9), daysAgo(20, 17), daysAgo(10), daysAgo(0)]);
    expect(rhythm).toEqual({ medianIntervalDays: 10, lastPurchasedAt: daysAgo(0), purchaseCount: 3 });
  });

  it("counts purchases after same-day collapse towards the minimum", () => {
    expect(repurchaseRhythm([daysAgo(10, 8), daysAgo(10, 12), daysAgo(10, 20), daysAgo(0)])).toBeNull();
  });

  it("measures intervals in whole calendar days, whatever the time of day", () => {
    const rhythm = repurchaseRhythm([daysAgo(14, 22), daysAgo(7, 8), daysAgo(0, 23)]);
    expect(rhythm?.medianIntervalDays).toBe(7);
    // The last purchase is the actual latest moment, not the start of its day.
    expect(rhythm?.lastPurchasedAt).toEqual(daysAgo(0, 23));
  });

  it("decides 'the same day' in the given time zone", () => {
    // 23:30 and 00:30 UTC are two UTC days but one Stockholm day (01:30
    // and 02:30 local, UTC+2).
    const late = new Date("2026-09-20T23:30:00Z");
    const later = new Date("2026-09-21T00:30:00Z");
    const purchases = [new Date("2026-09-06T12:00:00Z"), new Date("2026-09-13T12:00:00Z"), late, later];
    expect(repurchaseRhythm(purchases, "UTC")?.purchaseCount).toBe(4);
    expect(repurchaseRhythm(purchases, "Europe/Stockholm")?.purchaseCount).toBe(3);
  });
});

describe("getRepurchaseSuggestions", () => {
  // A 12-day rhythm: intervals 12, 12 → median 12.
  const twelveDay = (lastDaysAgo: number) => [daysAgo(lastDaysAgo + 24), daysAgo(lastDaysAgo + 12), daysAgo(lastDaysAgo)];

  function suggest(candidates: RepurchaseCandidate[], pending: string[] = [], limit?: number) {
    return getRepurchaseSuggestions({ candidates, pendingInventoryItemIds: new Set(pending), now: NOW, limit });
  }

  it("suggests once 0.85 × the median has passed since the last purchase", () => {
    expect(DUE_FRACTION).toBe(0.85);
    // 0.85 × 12 = 10.2 days.
    expect(suggest([candidate({ purchases: twelveDay(10) })])).toEqual([]);
    expect(suggest([candidate({ purchases: twelveDay(11) })])).toEqual([
      {
        inventoryItemId: "coffee",
        name: "Coffee",
        intervalDays: 12,
        medianIntervalDays: 12,
        lastPurchasedAt: daysAgo(11),
      },
    ]);
  });

  it("suggests exactly at the threshold", () => {
    // Median 20 → threshold 17 days, to the millisecond.
    const last = new Date(NOW.getTime() - 17 * DAY_MS);
    const purchases = [new Date(last.getTime() - 40 * DAY_MS), new Date(last.getTime() - 20 * DAY_MS), last];
    expect(suggest([candidate({ purchases })])).toHaveLength(1);
    const justShort = [...purchases.slice(0, 2), new Date(last.getTime() + 1)];
    expect(suggest([candidate({ purchases: justShort })])).toHaveLength(0);
  });

  it("keeps suggesting an item that's long overdue", () => {
    expect(suggest([candidate({ purchases: twelveDay(60) })])).toHaveLength(1);
  });

  it("never suggests without enough history", () => {
    expect(suggest([candidate({ purchases: [daysAgo(50), daysAgo(40)] })])).toEqual([]);
  });

  it("never suggests an item already pending on an active list", () => {
    expect(suggest([candidate({ purchases: twelveDay(20) })], ["coffee"])).toEqual([]);
  });

  it("skips a snoozed item until the snooze has passed", () => {
    const purchases = twelveDay(20);
    const future = new Date(NOW.getTime() + DAY_MS);
    const past = new Date(NOW.getTime() - 1);
    expect(suggest([candidate({ purchases, snoozedUntil: future })])).toEqual([]);
    expect(suggest([candidate({ purchases, snoozedUntil: past })])).toHaveLength(1);
    expect(suggest([candidate({ purchases, snoozedUntil: NOW })])).toHaveLength(1);
  });

  it("puts the most overdue first, relative to each item's own rhythm", () => {
    const weekly = [daysAgo(24), daysAgo(17), daysAgo(10)]; // 10/7 ≈ 1.43
    const monthly = [daysAgo(95), daysAgo(65), daysAgo(35)]; // 35/30 ≈ 1.17
    const result = suggest([
      candidate({ inventoryItemId: "flour", name: "Flour", purchases: monthly }),
      candidate({ inventoryItemId: "milk", name: "Milk", purchases: weekly }),
    ]);
    expect(result.map((s) => s.name)).toEqual(["Milk", "Flour"]);
  });

  it("breaks ties by name", () => {
    const result = suggest([
      candidate({ inventoryItemId: "b", name: "Bread", purchases: twelveDay(12) }),
      candidate({ inventoryItemId: "a", name: "Apples", purchases: twelveDay(12) }),
    ]);
    expect(result.map((s) => s.name)).toEqual(["Apples", "Bread"]);
  });

  it(`caps the chips at ${MAX_REPURCHASE_SUGGESTIONS} by default`, () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      candidate({ inventoryItemId: `item-${i}`, name: `Item ${i}`, purchases: twelveDay(12 + i) }),
    );
    const result = suggest(many);
    expect(result).toHaveLength(MAX_REPURCHASE_SUGGESTIONS);
    // The most overdue survive the cap.
    expect(result[0].name).toBe("Item 7");
    expect(suggest(many, [], 2)).toHaveLength(2);
  });

  it("rounds the chip's interval and never shows less than a day", () => {
    // Intervals 1, 2 → median 1.5 → "every 2 days".
    const result = suggest([candidate({ purchases: [daysAgo(5), daysAgo(4), daysAgo(2)] })]);
    expect(result[0].intervalDays).toBe(2);
    expect(result[0].medianIntervalDays).toBe(1.5);
    // Daily purchases → "every day".
    expect(suggest([candidate({ purchases: [daysAgo(3), daysAgo(2), daysAgo(1)] })])[0].intervalDays).toBe(1);
  });

  it("returns nothing for no candidates", () => {
    expect(suggest([])).toEqual([]);
  });
});

describe("repurchaseSnoozeUntil", () => {
  it("snoozes for one usual interval from now", () => {
    expect(repurchaseSnoozeUntil(12, NOW)).toEqual(new Date(NOW.getTime() + 12 * DAY_MS));
    expect(repurchaseSnoozeUntil(1.5, NOW)).toEqual(new Date(NOW.getTime() + 1.5 * DAY_MS));
  });

  it("snoozes at least a day", () => {
    expect(repurchaseSnoozeUntil(0, NOW)).toEqual(new Date(NOW.getTime() + DAY_MS));
  });

  it("brings an unbought item back once the snooze runs out", () => {
    const purchases = [daysAgo(44), daysAgo(32), daysAgo(20)];
    const snoozedUntil = repurchaseSnoozeUntil(12, NOW);
    const at = (now: Date) =>
      getRepurchaseSuggestions({
        candidates: [candidate({ purchases, snoozedUntil })],
        pendingInventoryItemIds: new Set(),
        now,
      });
    expect(at(new Date(NOW.getTime() + 11 * DAY_MS))).toEqual([]);
    expect(at(new Date(NOW.getTime() + 12 * DAY_MS))).toHaveLength(1);
  });
});
