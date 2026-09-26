// Tests the pure half of src/lib/incoming-stock.ts — which ticked rows count
// as stock on its way home — plus loadIncomingByItem's query shape against a
// mocked `db`. No database is touched.
import { describe, expect, it, vi } from "vitest";
import {
  INCOMING_MAX_AGE_DAYS,
  coveredQuantity,
  isIncoming,
  loadIncomingByItem,
  sumIncomingByItem,
  type IncomingRow,
} from "@/lib/incoming-stock";

const now = new Date("2026-09-26T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: Partial<IncomingRow> = {}): IncomingRow {
  return {
    inventoryItemId: "inv-1",
    quantity: 2,
    purchased: true,
    putAwayAt: null,
    checkedOffAt: new Date(now.getTime() - 60 * 60 * 1000),
    listStatus: "ACTIVE",
    listCompletedAt: null,
    ...overrides,
  };
}

describe("isIncoming", () => {
  it("counts a ticked, linked row that hasn't been put away", () => {
    expect(isIncoming(row(), now)).toBe(true);
  });

  it("counts it on a completed list too — finishing the trip doesn't unpack the bags", () => {
    expect(isIncoming(row({ listStatus: "COMPLETED", listCompletedAt: now }), now)).toBe(true);
  });

  it.each([
    ["not ticked", { purchased: false }],
    ["already put away", { putAwayAt: now }],
    ["not linked to inventory", { inventoryItemId: null }],
    ["on an archived list", { listStatus: "ARCHIVED" as const }],
    ["for no quantity", { quantity: 0 }],
  ])("doesn't count a row %s", (_label, overrides) => {
    expect(isIncoming(row(overrides), now)).toBe(false);
  });

  it(`stops counting a row ticked more than ${INCOMING_MAX_AGE_DAYS} days ago`, () => {
    const justInside = new Date(now.getTime() - INCOMING_MAX_AGE_DAYS * DAY_MS);
    const justOutside = new Date(justInside.getTime() - 1);
    expect(isIncoming(row({ checkedOffAt: justInside }), now)).toBe(true);
    expect(isIncoming(row({ checkedOffAt: justOutside }), now)).toBe(false);
  });

  it("dates an untimed (receipt-applied) row by its list's completion, and counts it while the list is open", () => {
    expect(isIncoming(row({ checkedOffAt: null, listCompletedAt: null }), now)).toBe(true);
    expect(
      isIncoming(row({ checkedOffAt: null, listStatus: "COMPLETED", listCompletedAt: new Date(now.getTime() - 30 * DAY_MS) }), now),
    ).toBe(false);
  });
});

describe("sumIncomingByItem", () => {
  it("sums per item, skips rows that don't count and rounds float noise", () => {
    const totals = sumIncomingByItem(
      [
        row({ quantity: 0.1 }),
        row({ quantity: 0.2 }),
        row({ inventoryItemId: "inv-2", quantity: 6 }),
        row({ inventoryItemId: "inv-3", putAwayAt: now }),
      ],
      now,
    );
    expect(totals).toEqual(
      new Map([
        ["inv-1", 0.3],
        ["inv-2", 6],
      ]),
    );
  });
});

describe("coveredQuantity", () => {
  it("adds what's on its way to what's at home, ignoring a negative incoming", () => {
    expect(coveredQuantity(0, 2)).toBe(2);
    expect(coveredQuantity(1, -5)).toBe(1);
  });
});

describe("loadIncomingByItem", () => {
  it("queries only this household's in-play lists and hands the rows to the pure calc", async () => {
    const findMany = vi.fn(async () => [
      {
        inventoryItemId: "inv-1",
        quantity: 2,
        purchased: true,
        putAwayAt: null,
        checkedOffAt: now,
        shoppingList: { status: "ACTIVE", completedAt: null },
      },
    ]);
    const db = { shoppingListItem: { findMany } } as unknown as Parameters<typeof loadIncomingByItem>[0];

    const totals = await loadIncomingByItem(db, "household-1", now, ["inv-1"]);

    expect(totals.get("inv-1")).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchased: true,
          putAwayAt: null,
          inventoryItemId: { in: ["inv-1"] },
          shoppingList: { householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } },
        }),
      }),
    );
  });
});
