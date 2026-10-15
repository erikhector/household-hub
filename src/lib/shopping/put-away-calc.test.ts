// Tests the pure put-away rules in src/lib/shopping/put-away-calc.ts: which
// mode defers stock, which rows a receipt may still price, and which lists
// earn a "Put away your shopping?" reminder (and who gets it).
import { describe, expect, it } from "vitest";
import {
  PUT_AWAY_REMINDER_DELAY_HOURS,
  awaitsReceiptPrice,
  defersToPutAway,
  isAwaitingPutAway,
  selectPutAwayReminders,
  withLocalTick,
  type ReminderList,
} from "@/lib/shopping/put-away-calc";

const now = new Date("2026-09-26T18:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR_MS);

describe("defersToPutAway", () => {
  it("defers only for an explicit ON_PUT_AWAY household", () => {
    expect(defersToPutAway({ inventorySyncMode: "ON_PUT_AWAY" })).toBe(true);
    expect(defersToPutAway({ inventorySyncMode: "ON_CHECK" })).toBe(false);
    // A household row loaded without the column keeps the original behaviour.
    expect(defersToPutAway({})).toBe(false);
  });
});

describe("isAwaitingPutAway", () => {
  it("is a ticked row with no putAwayAt", () => {
    expect(isAwaitingPutAway({ purchased: true, putAwayAt: null })).toBe(true);
    expect(isAwaitingPutAway({ purchased: true, putAwayAt: now })).toBe(false);
    expect(isAwaitingPutAway({ purchased: false, putAwayAt: null })).toBe(false);
  });
});

describe("withLocalTick", () => {
  const row = {
    id: "r1",
    purchased: false,
    putAwayAt: null as Date | null,
    priceRecordedAt: null as Date | null,
    inventoryItemId: "inv1" as string | null,
    estimatedPrice: 12 as number | null,
  };

  it("counts a linked, priced row at once outside put-away mode, like the action", () => {
    expect(withLocalTick(row, true, false, now)).toEqual({ ...row, purchased: true, putAwayAt: now, priceRecordedAt: now });
  });

  it("leaves priceRecordedAt alone for an unpriced or unlinked row", () => {
    expect(withLocalTick({ ...row, estimatedPrice: null }, true, false, now).priceRecordedAt).toBeNull();
    expect(withLocalTick({ ...row, inventoryItemId: null }, true, false, now).priceRecordedAt).toBeNull();
  });

  it("puts a row in the cart, not away, in put-away mode", () => {
    const ticked = withLocalTick({ ...row, putAwayAt: hoursAgo(5) }, true, true, now);
    expect(ticked).toMatchObject({ purchased: true, putAwayAt: null });
    expect(isAwaitingPutAway(ticked)).toBe(true);
  });

  it("undoes the purchase on an untick", () => {
    const ticked = { ...row, purchased: true, putAwayAt: now, priceRecordedAt: now };
    expect(withLocalTick(ticked, false, false, now)).toEqual({ ...row, purchased: false });
  });
});

describe("awaitsReceiptPrice", () => {
  it("accepts any unticked row", () => {
    expect(awaitsReceiptPrice({ purchased: false, putAwayAt: null, priceRecordedAt: null })).toBe(true);
  });

  it("accepts a ticked row only while neither its stock nor its price has been recorded", () => {
    expect(awaitsReceiptPrice({ purchased: true, putAwayAt: null, priceRecordedAt: null })).toBe(true);
    expect(awaitsReceiptPrice({ purchased: true, putAwayAt: now, priceRecordedAt: null })).toBe(false);
    expect(awaitsReceiptPrice({ purchased: true, putAwayAt: null, priceRecordedAt: now })).toBe(false);
  });

  it("treats a ticked row loaded without the columns as already handled", () => {
    expect(awaitsReceiptPrice({ purchased: true })).toBe(false);
  });
});

describe("selectPutAwayReminders", () => {
  function list(overrides: Partial<ReminderList> = {}): ReminderList {
    return {
      id: "list-1",
      name: "Next shop",
      putAwayRemindedAt: null,
      awaiting: [{ checkedOffAt: hoursAgo(4), checkedOffByUserId: "user-1" }],
      ...overrides,
    };
  }

  it(`reminds whoever ticked the rows once the trip is ${PUT_AWAY_REMINDER_DELAY_HOURS}h old`, () => {
    expect(selectPutAwayReminders([list()], now)).toEqual([
      { listId: "list-1", listName: "Next shop", count: 1, recipientUserIds: ["user-1"] },
    ]);
  });

  it("waits until the delay has passed", () => {
    expect(
      selectPutAwayReminders([list({ awaiting: [{ checkedOffAt: hoursAgo(2), checkedOffByUserId: "user-1" }] })], now),
    ).toEqual([]);
  });

  it("counts every waiting row, including fresher ones and receipt-applied ones", () => {
    const [reminder] = selectPutAwayReminders(
      [
        list({
          awaiting: [
            { checkedOffAt: hoursAgo(5), checkedOffByUserId: "user-1" },
            { checkedOffAt: hoursAgo(1), checkedOffByUserId: "user-2" },
            // Priced by a receipt an hour ago: too fresh to trigger yet.
            { checkedOffAt: null, priceRecordedAt: hoursAgo(1), checkedOffByUserId: "user-3" },
          ],
        }),
      ],
      now,
    );
    expect(reminder.count).toBe(3);
    // Only the rows that triggered it pick the recipients.
    expect(reminder.recipientUserIds).toEqual(["user-1"]);
  });

  it("reminds about rows a receipt priced but nobody ticked, dated by the receipt", () => {
    const receiptOnly = list({
      awaiting: [{ checkedOffAt: null, priceRecordedAt: hoursAgo(4), checkedOffByUserId: "user-3" }],
    });
    expect(selectPutAwayReminders([receiptOnly], now)).toEqual([
      { listId: "list-1", listName: "Next shop", count: 1, recipientUserIds: ["user-3"] },
    ]);
    // Undated rows (no tick, no receipt) never trigger one.
    expect(
      selectPutAwayReminders([list({ awaiting: [{ checkedOffAt: null, priceRecordedAt: null, checkedOffByUserId: null }] })], now),
    ).toEqual([]);
  });

  it("falls back to the whole household when a triggering row has no known ticker", () => {
    const [reminder] = selectPutAwayReminders(
      [
        list({
          awaiting: [
            { checkedOffAt: hoursAgo(4), checkedOffByUserId: "user-1" },
            { checkedOffAt: hoursAgo(4), checkedOffByUserId: null },
          ],
        }),
      ],
      now,
    );
    expect(reminder.recipientUserIds).toBeNull();
  });

  it("reminds once per trip: not again for rows ticked before the last reminder, but again for a newer trip", () => {
    const remindedAt = hoursAgo(3);
    expect(selectPutAwayReminders([list({ putAwayRemindedAt: remindedAt })], now)).toEqual([]);

    const newerTrip = list({
      putAwayRemindedAt: hoursAgo(30),
      awaiting: [
        { checkedOffAt: hoursAgo(32), checkedOffByUserId: "user-1" },
        { checkedOffAt: hoursAgo(5), checkedOffByUserId: "user-2" },
      ],
    });
    expect(selectPutAwayReminders([newerTrip], now)).toEqual([
      { listId: "list-1", listName: "Next shop", count: 2, recipientUserIds: ["user-2"] },
    ]);
  });

  it("never nags about a trip too old to count as incoming any more", () => {
    expect(
      selectPutAwayReminders([list({ awaiting: [{ checkedOffAt: hoursAgo(24 * 8), checkedOffByUserId: "user-1" }] })], now),
    ).toEqual([]);
  });

  it("dedupes and sorts recipients", () => {
    const [reminder] = selectPutAwayReminders(
      [
        list({
          awaiting: [
            { checkedOffAt: hoursAgo(4), checkedOffByUserId: "user-b" },
            { checkedOffAt: hoursAgo(4), checkedOffByUserId: "user-a" },
            { checkedOffAt: hoursAgo(5), checkedOffByUserId: "user-b" },
          ],
        }),
      ],
      now,
    );
    expect(reminder.recipientUserIds).toEqual(["user-a", "user-b"]);
  });
});
