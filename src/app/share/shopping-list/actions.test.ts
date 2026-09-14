// Tests the genuinely unauthenticated actions in
// src/app/share/shopping-list/actions.ts — no requireHousehold/session mock
// at all, since these actions take none. All I/O (Prisma, next/cache,
// recordOutOfStockTransition) is mocked — no database call is made. See
// REQUIREMENTS.md's "Testing" section and the identical mocked-Prisma
// convention in src/app/dashboard/shopping-list/actions.test.ts.
//
// The critical case here is toggleItemViaShareTokenAction rejecting an
// itemId that doesn't belong to the token's own ShoppingList — that
// cross-list/cross-household check is the actual security boundary this
// public, token-only endpoint relies on (see the module's top comment).
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  shareLinkFindUniqueMock,
  shoppingListFindUniqueMock,
  shoppingListItemFindFirstMock,
  shoppingListItemUpdateMock,
  shoppingListItemCountMock,
  inventoryItemUpdateMock,
  inventoryItemFindUniqueMock,
  priceHistoryCreateMock,
  notificationFindFirstMock,
  notificationCreateMock,
  transactionMock,
  recordOutOfStockTransitionMock,
  recordRestockTransitionMock,
  recordListClearedTransitionMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  shareLinkFindUniqueMock: vi.fn(),
  shoppingListFindUniqueMock: vi.fn(),
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemUpdateMock: vi.fn(),
  shoppingListItemCountMock: vi.fn(async () => 0),
  inventoryItemUpdateMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  priceHistoryCreateMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  recordOutOfStockTransitionMock: vi.fn(async () => {}),
  recordRestockTransitionMock: vi.fn(async () => {}),
  recordListClearedTransitionMock: vi.fn(async () => {}),
  revalidatePathMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      shoppingListItem: { update: shoppingListItemUpdateMock, count: shoppingListItemCountMock },
      shoppingList: { findUnique: shoppingListFindUniqueMock },
      inventoryItem: { update: inventoryItemUpdateMock, findUnique: inventoryItemFindUniqueMock },
      priceHistory: { create: priceHistoryCreateMock },
      notification: { findFirst: notificationFindFirstMock, create: notificationCreateMock },
    };
    return cb(tx);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingListShareLink: { findUnique: shareLinkFindUniqueMock },
    shoppingList: { findUnique: shoppingListFindUniqueMock },
    shoppingListItem: { findFirst: shoppingListItemFindFirstMock, update: shoppingListItemUpdateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/notifications", () => ({
  recordOutOfStockTransition: recordOutOfStockTransitionMock,
  recordRestockTransition: recordRestockTransitionMock,
  recordListClearedTransition: recordListClearedTransitionMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { getShoppingListByShareToken, toggleItemViaShareTokenAction } = await import(
  "@/app/share/shopping-list/actions"
);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getShoppingListByShareToken", () => {
  it("returns null for an unknown token", async () => {
    shareLinkFindUniqueMock.mockResolvedValue(null);

    const result = await getShoppingListByShareToken("unknown-token");

    expect(result).toBeNull();
    expect(shoppingListFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns null for a revoked token", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: new Date(),
    });

    const result = await getShoppingListByShareToken("revoked-token");

    expect(result).toBeNull();
    expect(shoppingListFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns the list and its items for an active token", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: null,
    });
    shoppingListFindUniqueMock.mockResolvedValue({
      id: "list-1",
      name: "Weekly shop",
      items: [
        { id: "item-1", name: "Milk", quantity: 2, unit: "l", purchased: false },
      ],
    });

    const result = await getShoppingListByShareToken("active-token");

    expect(result).toEqual({
      id: "list-1",
      name: "Weekly shop",
      items: [{ id: "item-1", name: "Milk", quantity: 2, unit: "l", purchased: false }],
    });
  });
});

describe("toggleItemViaShareTokenAction", () => {
  it("rejects an unknown token", async () => {
    shareLinkFindUniqueMock.mockResolvedValue(null);

    const result = await toggleItemViaShareTokenAction("unknown-token", "item-1");

    expect(result.error).toBe("This share link is invalid or has been revoked");
    expect(shoppingListItemFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked token", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: new Date(),
    });

    const result = await toggleItemViaShareTokenAction("revoked-token", "item-1");

    expect(result.error).toBe("This share link is invalid or has been revoked");
    expect(shoppingListItemFindFirstMock).not.toHaveBeenCalled();
  });

  // The actual security boundary: a valid, active token for list A must not
  // let the caller toggle an item that belongs to some other list (B) — even
  // though the itemId itself is real. toggleItemViaShareTokenAction scopes
  // its lookup to shareLink.shoppingListId, so a mismatched pairing resolves
  // to "not found" rather than silently operating on the wrong list's item.
  it("rejects an itemId that belongs to a different list than the token's own", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: null,
    });
    // Simulates the query being correctly scoped: an item that exists but
    // under a different shoppingListId never matches this where clause.
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-from-list-2");

    expect(shoppingListItemFindFirstMock).toHaveBeenCalledWith({
      where: { id: "item-from-list-2", shoppingListId: "list-1" },
      include: { inventoryItem: true },
    });
    expect(result.error).toBe("Item not found");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("marking purchased increases linked inventory quantity and logs price history", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: null,
    });
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 3,
      estimatedPrice: 25,
      inventoryItem: { id: "inv-1", quantity: 2, lowStockThreshold: 1 },
    });
    shoppingListFindUniqueMock.mockResolvedValue({ householdId: "household-1" });
    shoppingListItemCountMock.mockResolvedValue(2);

    const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { purchased: true },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 5 },
    });
    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(
      expect.anything(),
      "household-1",
      "inv-1",
      2,
      5,
    );
    expect(recordRestockTransitionMock).toHaveBeenCalledWith(
      expect.anything(),
      "household-1",
      "inv-1",
      2,
      1,
      5,
      1,
    );
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 25 },
    });
    // Two pending items still remain after this one — not a clearing
    // transition, but the counts are still passed through correctly.
    expect(recordListClearedTransitionMock).toHaveBeenCalledWith(
      expect.anything(),
      "household-1",
      "list-1",
      3,
      2,
    );
  });

  it("un-marking purchased decreases linked inventory quantity, floored at zero", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: null,
    });
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      quantity: 10,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });
    shoppingListFindUniqueMock.mockResolvedValue({ householdId: "household-1" });

    const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

    expect(result).toEqual({});
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 0 },
    });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    // Un-marking can only ever add a pending item back, never clear the
    // list — no LIST_CLEARED check needed.
    expect(recordListClearedTransitionMock).not.toHaveBeenCalled();
  });

  it("returns 'Item not found' for an item that doesn't exist at all", async () => {
    shareLinkFindUniqueMock.mockResolvedValue({
      id: "link-1",
      shoppingListId: "list-1",
      revokedAt: null,
    });
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "does-not-exist");

    expect(result.error).toBe("Item not found");
  });
});
