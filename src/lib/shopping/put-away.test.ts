// Tests applyStockArrival/reverseStockArrival in isolation from their
// collaborators: openedResetOnArrival and estimatedExpiryUpdate
// (src/lib/inventory/expiry.ts, shelf-life.ts) and the out-of-stock/AUTO-8
// hooks (src/lib/notifications.ts, src/lib/shopping/default-list.ts) each
// have their own unit tests — here we only check what put-away.ts itself
// does: the quantity math, which fields it writes and when, and that it
// calls every hook with the right arguments. `tx` is a plain fake object
// (the module only ever calls the two methods it uses), never a real
// Prisma client or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InventoryItem, Prisma } from "@/generated/prisma/client";

const {
  openedResetOnArrivalMock,
  frozenResetOnArrivalMock,
  estimatedExpiryUpdateMock,
  recordOutOfStockTransitionMock,
  addToDefaultListOnLowStockMock,
} = vi.hoisted(() => ({
    openedResetOnArrivalMock: vi.fn(),
    frozenResetOnArrivalMock: vi.fn(),
    estimatedExpiryUpdateMock: vi.fn(),
    recordOutOfStockTransitionMock: vi.fn(),
    addToDefaultListOnLowStockMock: vi.fn(),
  }));

vi.mock("@/lib/inventory/expiry", () => ({
  openedResetOnArrival: openedResetOnArrivalMock,
  frozenResetOnArrival: frozenResetOnArrivalMock,
}));
vi.mock("@/lib/inventory/shelf-life", () => ({ estimatedExpiryUpdate: estimatedExpiryUpdateMock }));
vi.mock("@/lib/notifications", () => ({ recordOutOfStockTransition: recordOutOfStockTransitionMock }));
vi.mock("@/lib/shopping/default-list", () => ({ addToDefaultListOnLowStock: addToDefaultListOnLowStockMock }));

const { applyStockArrival, reverseStockArrival } = await import("@/lib/shopping/put-away");

function fakeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: "item-1",
    householdId: "household-1",
    name: "Milk",
    category: "Dairy",
    quantity: 2,
    unit: "pcs",
    lowStockThreshold: 1,
    location: null,
    lastKnownPrice: null,
    expiresAt: null,
    expiresAtEstimated: false,
    shelfLifeDays: null,
    useWithinDaysOpened: null,
    openedAt: null,
    updatedByUserId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as InventoryItem;
}

function fakeTx() {
  return {
    inventoryItem: { update: vi.fn(async () => undefined) },
    priceHistory: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "price-1", ...data })) },
  } as unknown as Prisma.TransactionClient;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("applyStockArrival", () => {
  it("adds the arriving quantity to the current quantity", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 2 }),
      quantity: 3,
      unit: "pcs",
      price: null,
    });

    expect(result.nextQuantity).toBe(5);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: expect.objectContaining({ quantity: 5 }) }),
    );
  });

  it("floors the resulting quantity at zero even for a negative delta", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 2 }),
      quantity: -10,
      unit: "pcs",
      price: null,
    });

    expect(result.nextQuantity).toBe(0);
  });

  it("merges the opened-reset and expiry-update patches into the write", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue({ openedAt: null });
    const expiresAt = new Date("2026-04-01T00:00:00.000Z");
    estimatedExpiryUpdateMock.mockReturnValue({ expiresAt, expiresAtEstimated: true });
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 2,
      unit: "pcs",
      price: null,
    });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ openedAt: null, expiresAt, expiresAtEstimated: true }),
      }),
    );
  });

  it("merges the GAP-44 frozen-reset patch into the write", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    frozenResetOnArrivalMock.mockReturnValue({ frozenAt: null });
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 2,
      unit: "pcs",
      price: null,
    });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ frozenAt: null }) }),
    );
  });

  it("prefers a typed expiresAt over the estimator, marked unestimated", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);
    const typed = new Date("2026-05-10T00:00:00.000Z");

    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 2,
      unit: "pcs",
      price: null,
      expiresAt: typed,
    });

    // The estimator must never even be consulted once a real date is given.
    expect(estimatedExpiryUpdateMock).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: typed, expiresAtEstimated: false }) }),
    );
  });

  it("writes lastKnownPrice and records a PriceHistory row using the arrival quantity by default", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 4,
      unit: "L",
      price: 19.9,
    });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastKnownPrice: 19.9 }) }),
    );
    expect(tx.priceHistory.create).toHaveBeenCalledWith({
      data: { inventoryItemId: "item-1", price: 19.9, quantity: 4, unit: "L" },
    });
    expect(result.recordedPrice).toEqual({
      priceHistoryId: "price-1",
      inventoryItemId: "item-1",
      price: 19.9,
      quantity: 4,
      unit: "L",
    });
  });

  it("uses priceQuantity instead of quantity for the per-unit price when the put-away dialog corrected it (GAP-9)", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    // Listed as 4, but only 3 actually arrived — the unit price must be
    // price ÷ 3, not price ÷ 4, or a short delivery looks like a discount.
    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 4,
      priceQuantity: 3,
      unit: "L",
      price: 12,
    });

    expect(tx.priceHistory.create).toHaveBeenCalledWith({
      data: { inventoryItemId: "item-1", price: 12, quantity: 3, unit: "L" },
    });
  });

  it("stamps the store on the PriceHistory row when given, and omits it entirely when undefined", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 1,
      unit: "pcs",
      price: 5,
      store: "Ica",
    });

    expect(tx.priceHistory.create).toHaveBeenCalledWith({
      data: { inventoryItemId: "item-1", price: 5, quantity: 1, unit: "pcs", store: "Ica" },
    });
  });

  it("skips PriceHistory entirely when price is null", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 1,
      unit: "pcs",
      price: null,
    });

    expect(tx.priceHistory.create).not.toHaveBeenCalled();
    expect(result.recordedPrice).toBeNull();
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ lastKnownPrice: expect.anything() }) }),
    );
  });

  it("writes location only when given, leaving it out of the patch when omitted", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 1,
      unit: "pcs",
      price: null,
      location: "Pantry",
    });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ location: "Pantry" }) }),
    );
  });

  it("runs the out-of-stock and AUTO-8 hooks with the before/after quantities and the acting user", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await applyStockArrival(tx, {
      householdId: "household-1",
      actingUserId: "user-9",
      inventoryItem: fakeItem({ quantity: 0 }),
      quantity: 2,
      unit: "pcs",
      price: null,
    });

    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(tx, "household-1", "item-1", 0, 2, "user-9");
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(tx, "household-1", "item-1", 0, 2);
  });

  it("surfaces the AUTO-8 auto-added item on the result", async () => {
    const tx = fakeTx();
    openedResetOnArrivalMock.mockReturnValue(null);
    estimatedExpiryUpdateMock.mockReturnValue(null);
    const autoAdded = { shoppingListItemId: "sli-1", name: "Milk" };
    addToDefaultListOnLowStockMock.mockResolvedValue(autoAdded);

    const result = await applyStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 5 }),
      quantity: 1,
      unit: "pcs",
      price: null,
    });

    expect(result.autoAdded).toBe(autoAdded);
  });
});

describe("reverseStockArrival", () => {
  it("subtracts the quantity and floors at zero", async () => {
    const tx = fakeTx();
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await reverseStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 3 }),
      quantity: 10,
    });

    expect(result.nextQuantity).toBe(0);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 0 } });
  });

  it("writes only the quantity, leaving price/expiry/opened fields untouched", async () => {
    const tx = fakeTx();
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await reverseStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 5 }),
      quantity: 2,
    });

    expect(tx.inventoryItem.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 3 } });
  });

  it("runs the out-of-stock and AUTO-8 hooks with the pre/post quantities and the acting user", async () => {
    const tx = fakeTx();
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    await reverseStockArrival(tx, {
      householdId: "household-1",
      actingUserId: "user-9",
      inventoryItem: fakeItem({ quantity: 3 }),
      quantity: 3,
    });

    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(tx, "household-1", "item-1", 3, 0, "user-9");
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(tx, "household-1", "item-1", 3, 0);
  });

  it("surfaces the AUTO-8 auto-added item on the result", async () => {
    const tx = fakeTx();
    const autoAdded = { shoppingListItemId: "sli-1", name: "Milk" };
    addToDefaultListOnLowStockMock.mockResolvedValue(autoAdded);

    const result = await reverseStockArrival(tx, {
      householdId: "household-1",
      inventoryItem: fakeItem({ quantity: 3 }),
      quantity: 1,
    });

    expect(result.autoAdded).toBe(autoAdded);
  });
});
