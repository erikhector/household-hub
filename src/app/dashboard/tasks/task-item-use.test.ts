// GAP-87: the stock half of ticking a task that uses up a pantry item. The
// transaction client is a plain object of mocks; no database is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordOutOfStockTransitionMock, recordStockEventMock, addToDefaultListOnLowStockMock } = vi.hoisted(() => ({
  recordOutOfStockTransitionMock: vi.fn(),
  recordStockEventMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({ recordOutOfStockTransition: recordOutOfStockTransitionMock }));
vi.mock("@/lib/inventory/stock-history", () => ({ recordStockEvent: recordStockEventMock }));
vi.mock("@/lib/shopping/default-list", () => ({ addToDefaultListOnLowStock: addToDefaultListOnLowStockMock }));

const { consumeTaskItem, restoreTaskItem } = await import("@/app/dashboard/tasks/task-item-use");

const tx = {
  inventoryItem: { findFirst: vi.fn(), updateMany: vi.fn() },
  inventoryItemEvent: { findFirst: vi.fn(), updateMany: vi.fn() },
  notification: { updateMany: vi.fn() },
};
const db = tx as unknown as Parameters<typeof consumeTaskItem>[0];

const ids = { householdId: "household-1", userId: "user-1", taskId: "task-1" };
const unlink = { where: { taskId: "task-1", householdId: "household-1" }, data: { taskId: null } };

beforeEach(() => {
  addToDefaultListOnLowStockMock.mockResolvedValue(null);
  tx.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("consumeTaskItem", () => {
  it("takes the amount off this household's item and links the event to the task", async () => {
    tx.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", name: "Dishwasher tablets", unit: "pcs", quantity: 3 });

    const result = await consumeTaskItem(db, { ...ids, itemId: "item-1", quantity: 1 });

    expect(tx.inventoryItemEvent.updateMany).toHaveBeenCalledWith(unlink);
    expect(tx.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1" },
      select: { id: true, name: true, unit: true, quantity: true },
    });
    // Compare-and-set on the amount it read, so a tap in between isn't lost.
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1", quantity: 3 },
      data: { quantity: 2, everStocked: true, updatedByUserId: "user-1" },
    });
    expect(recordStockEventMock).toHaveBeenCalledWith(db, {
      householdId: "household-1",
      itemId: "item-1",
      userId: "user-1",
      previousQuantity: 3,
      nextQuantity: 2,
      reason: "used",
      taskId: "task-1",
    });
    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(db, "household-1", "item-1", 3, 2, "user-1");
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(db, "household-1", "item-1", 3, 2);
    expect(result).toEqual({ used: { itemName: "Dishwasher tablets", quantity: 1, unit: "pcs" }, autoAdded: null });
  });

  it("never goes below 0, and says how much was really used", async () => {
    tx.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", name: "Filters", unit: "pcs", quantity: 0.5 });

    const result = await consumeTaskItem(db, { ...ids, itemId: "item-1", quantity: 2 });

    expect(tx.inventoryItem.updateMany.mock.calls[0][0].data.quantity).toBe(0);
    expect(result.used).toEqual({ itemName: "Filters", quantity: 0.5, unit: "pcs" });
  });

  it("uses nothing at 0, for a missing or foreign item, or with no link, but still unlinks older events", async () => {
    tx.inventoryItem.findFirst.mockResolvedValueOnce({ id: "item-1", name: "Filters", unit: "pcs", quantity: 0 });
    expect(await consumeTaskItem(db, { ...ids, itemId: "item-1", quantity: 1 })).toEqual({ used: null, autoAdded: null });

    tx.inventoryItem.findFirst.mockResolvedValueOnce(null);
    expect(await consumeTaskItem(db, { ...ids, itemId: "foreign", quantity: 1 })).toEqual({ used: null, autoAdded: null });

    expect(await consumeTaskItem(db, { ...ids, itemId: null, quantity: null })).toEqual({ used: null, autoAdded: null });

    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(recordStockEventMock).not.toHaveBeenCalled();
    expect(tx.inventoryItemEvent.updateMany).toHaveBeenCalledTimes(3);
  });

  it("re-reads and retries when another write moved the amount in between", async () => {
    tx.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: "item-1", name: "Filters", unit: "pcs", quantity: 3 })
      .mockResolvedValueOnce({ id: "item-1", name: "Filters", unit: "pcs", quantity: 5 });
    tx.inventoryItem.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    const result = await consumeTaskItem(db, { ...ids, itemId: "item-1", quantity: 1 });

    expect(tx.inventoryItem.updateMany).toHaveBeenLastCalledWith({
      where: { id: "item-1", householdId: "household-1", quantity: 5 },
      data: { quantity: 4, everStocked: true, updatedByUserId: "user-1" },
    });
    expect(recordStockEventMock).toHaveBeenCalledTimes(1);
    expect(recordStockEventMock.mock.calls[0][1]).toMatchObject({ previousQuantity: 5, nextQuantity: 4 });
    expect(result.used?.quantity).toBe(1);
  });
});

describe("restoreTaskItem", () => {
  it("adds back exactly what the task's latest used event took, then unlinks it", async () => {
    tx.inventoryItemEvent.findFirst.mockResolvedValue({ itemId: "item-1", delta: -0.5 });
    tx.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", name: "Filters", unit: "pcs", quantity: 0 });

    expect(await restoreTaskItem(db, ids)).toBe(true);

    expect(tx.inventoryItemEvent.findFirst).toHaveBeenCalledWith({
      where: { taskId: "task-1", householdId: "household-1", reason: "used" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { itemId: true, delta: true },
    });
    expect(tx.inventoryItemEvent.updateMany).toHaveBeenCalledWith(unlink);
    expect(tx.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1" },
      select: { id: true, name: true, unit: true, quantity: true },
    });
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1", quantity: 0 },
      data: { quantity: 0.5, everStocked: true, updatedByUserId: "user-1" },
    });
    expect(recordStockEventMock).toHaveBeenCalledWith(db, {
      householdId: "household-1",
      itemId: "item-1",
      userId: "user-1",
      previousQuantity: 0,
      nextQuantity: 0.5,
      reason: "adjusted",
    });
    // Back from 0, so the tick's "Out of stock" goes.
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { householdId: "household-1", inventoryItemId: "item-1", kind: "OUT_OF_STOCK", dismissedAt: null },
      data: { dismissedAt: expect.any(Date) },
    });
  });

  it("restores nothing when the tick used nothing, or the item is gone", async () => {
    tx.inventoryItemEvent.findFirst.mockResolvedValueOnce(null);
    expect(await restoreTaskItem(db, ids)).toBe(false);

    tx.inventoryItemEvent.findFirst.mockResolvedValueOnce({ itemId: "item-1", delta: -1 });
    tx.inventoryItem.findFirst.mockResolvedValueOnce(null);
    expect(await restoreTaskItem(db, ids)).toBe(false);

    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryItemEvent.updateMany).toHaveBeenCalledTimes(2);
  });
});
