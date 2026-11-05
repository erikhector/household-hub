import { describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { STOCK_HISTORY_CAP, reasonForDelta, recordStockEvent, recordStockEvents } from "@/lib/inventory/stock-history";

// An in-memory stand-in for the three calls the journal makes, ordered the
// way the database would (createdAt, then id), so the cap is tested for what
// it keeps and drops rather than for which mock was called.
type Row = { id: string; itemId: string; householdId: string; userId: string | null; delta: number; reason: string; createdAt: number };

function fakeDb() {
  const rows: Row[] = [];
  let clock = 0;
  const db = {
    inventoryItemEvent: {
      createMany: async ({ data }: { data: Omit<Row, "id" | "createdAt">[] }) => {
        for (const d of data) {
          clock += 1;
          rows.push({ ...d, id: `e${String(clock).padStart(5, "0")}`, createdAt: clock });
        }
      },
      findMany: async ({ where }: { where: { itemId: { in: string[] }; householdId?: { in: string[] } } }) =>
        rows
          .filter((r) => where.itemId.in.includes(r.itemId))
          .filter((r) => !where.householdId || where.householdId.in.includes(r.householdId))
          .sort((a, b) => a.itemId.localeCompare(b.itemId) || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .map(({ id, itemId }) => ({ id, itemId })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) rows.splice(rows.findIndex((r) => r.id === id), 1);
      },
    },
  };
  return { rows, db: db as unknown as Prisma.TransactionClient };
}

const change = (over: Partial<Parameters<typeof recordStockEvent>[1]> = {}) => ({
  householdId: "household-1",
  itemId: "item-1",
  userId: "user-1",
  previousQuantity: 3,
  nextQuantity: 2,
  reason: "used" as const,
  ...over,
});

describe("recordStockEvent", () => {
  it("writes the signed delta, the reason and the given household and user", async () => {
    const { rows, db } = fakeDb();

    await recordStockEvent(db, change());

    expect(rows).toEqual([
      expect.objectContaining({ itemId: "item-1", householdId: "household-1", userId: "user-1", delta: -1, reason: "used" }),
    ]);
  });

  it("rounds the delta to two decimals", async () => {
    const { rows, db } = fakeDb();

    await recordStockEvent(db, change({ previousQuantity: 0.1, nextQuantity: 0.3 }));

    expect(rows[0].delta).toBe(0.2);
  });

  it("writes nothing when the quantity didn't change (a '-1' on an item already at 0)", async () => {
    const { rows, db } = fakeDb();

    await recordStockEvent(db, change({ previousQuantity: 0, nextQuantity: 0 }));

    expect(rows).toEqual([]);
  });

  it("stores no user for a change without one", async () => {
    const { rows, db } = fakeDb();

    await recordStockEvent(db, change({ userId: undefined }));

    expect(rows[0].userId).toBeNull();
  });

  it("keeps the newest 50 per item: the 51st event drops the oldest", async () => {
    const { rows, db } = fakeDb();

    for (let i = 0; i < STOCK_HISTORY_CAP; i++) await recordStockEvent(db, change());
    expect(rows).toHaveLength(STOCK_HISTORY_CAP);
    const oldest = rows[0].id;

    await recordStockEvent(db, change());

    expect(rows).toHaveLength(STOCK_HISTORY_CAP);
    expect(rows.map((r) => r.id)).not.toContain(oldest);
  });

  it("caps each item on its own", async () => {
    const { rows, db } = fakeDb();
    for (let i = 0; i < STOCK_HISTORY_CAP; i++) await recordStockEvent(db, change({ itemId: "item-1" }));

    await recordStockEvent(db, change({ itemId: "item-2" }));

    expect(rows.filter((r) => r.itemId === "item-1")).toHaveLength(STOCK_HISTORY_CAP);
    expect(rows.filter((r) => r.itemId === "item-2")).toHaveLength(1);
  });

  it("trims only the writing household's rows (every query scoped by household)", async () => {
    const { rows, db } = fakeDb();
    for (let i = 0; i < STOCK_HISTORY_CAP; i++) await recordStockEvent(db, change({ householdId: "household-2" }));

    await recordStockEvent(db, change());

    expect(rows.filter((r) => r.householdId === "household-2")).toHaveLength(STOCK_HISTORY_CAP);
    expect(rows.filter((r) => r.householdId === "household-1")).toHaveLength(1);
  });
});

describe("recordStockEvents", () => {
  it("records a whole batch and trims every touched item", async () => {
    const { rows, db } = fakeDb();
    for (let i = 0; i < STOCK_HISTORY_CAP; i++) await recordStockEvent(db, change({ itemId: "item-1" }));

    await recordStockEvents(db, [change({ itemId: "item-1" }), change({ itemId: "item-2" }), change({ itemId: "item-3", nextQuantity: 3 })]);

    expect(rows.filter((r) => r.itemId === "item-1")).toHaveLength(STOCK_HISTORY_CAP);
    expect(rows.filter((r) => r.itemId === "item-2")).toHaveLength(1);
    // item-3 didn't change, so it has no event.
    expect(rows.filter((r) => r.itemId === "item-3")).toHaveLength(0);
  });
});

describe("reasonForDelta", () => {
  it("is 'used' for a decrease and 'restocked' for an increase", () => {
    expect(reasonForDelta(-1)).toBe("used");
    expect(reasonForDelta(2)).toBe("restocked");
  });
});
