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
  inventoryItemFindManyMock,
  priceHistoryCreateMock,
  notificationFindFirstMock,
  notificationCreateMock,
  transactionMock,
  recordOutOfStockTransitionMock,
  recordListClearedTransitionMock,
  recordPriceSpikesMock,
  addToDefaultListOnLowStockMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  shareLinkFindUniqueMock: vi.fn(),
  shoppingListFindUniqueMock: vi.fn(),
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemUpdateMock: vi.fn(),
  shoppingListItemCountMock: vi.fn(async () => 0),
  inventoryItemUpdateMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(async (): Promise<{ id: string; category: string }[]> => []),
  priceHistoryCreateMock: vi.fn(async () => ({ id: "ph-1" })),
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  recordOutOfStockTransitionMock: vi.fn(async () => {}),
  recordListClearedTransitionMock: vi.fn(async () => {}),
  recordPriceSpikesMock: vi.fn(async () => {}),
  addToDefaultListOnLowStockMock: vi.fn(async () => null),
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
    inventoryItem: { findMany: inventoryItemFindManyMock },
    shoppingListItem: { findFirst: shoppingListItemFindFirstMock, update: shoppingListItemUpdateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/notifications", () => ({
  recordOutOfStockTransition: recordOutOfStockTransitionMock,
  recordListClearedTransition: recordListClearedTransitionMock,
  recordPriceSpikes: recordPriceSpikesMock,
}));
vi.mock("@/lib/shopping/default-list", () => ({
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  revalidateAutoAdded: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en) };
});

const { getShoppingListByShareToken, toggleItemViaShareTokenAction } = await import(
  "@/app/share/shopping-list/actions"
);

const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

afterEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
});

// SEC-13: both token-only endpoints are throttled per token, mirroring the
// calendar feed's 120 an hour.
describe("share-list rate limit", () => {
  it("returns null past 120 reads in the window, without touching the database", async () => {
    shareLinkFindUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 120; i++) expect(await getShoppingListByShareToken("busy-token")).toBeNull();
    expect(shareLinkFindUniqueMock).toHaveBeenCalledTimes(120);

    expect(await getShoppingListByShareToken("busy-token")).toBeNull();
    expect(shareLinkFindUniqueMock).toHaveBeenCalledTimes(120);

    // A different token has its own budget.
    await getShoppingListByShareToken("other-token");
    expect(shareLinkFindUniqueMock).toHaveBeenCalledTimes(121);
  });

  it("rejects the 121st toggle in the window, without touching the database", async () => {
    shareLinkFindUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 120; i++) {
      expect(await toggleItemViaShareTokenAction("busy-token", "item-1")).toEqual({
        error: "This share link is invalid or has been revoked",
      });
    }

    const limited = await toggleItemViaShareTokenAction("busy-token", "item-1");
    expect(limited.error).toBe("Too many changes to this list. Please wait a while and try again.");
    expect(shareLinkFindUniqueMock).toHaveBeenCalledTimes(120);
  });

  it("keeps reads and toggles in separate buckets", async () => {
    shareLinkFindUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 120; i++) await getShoppingListByShareToken("busy-token");

    // Reads are used up, but a toggle still reaches the token lookup.
    await toggleItemViaShareTokenAction("busy-token", "item-1");
    expect(shareLinkFindUniqueMock).toHaveBeenCalledTimes(121);
  });
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
      householdId: "hh-1",
      household: { name: "The Smiths", categoryOrderLearned: { "auto:dairy": 0.2, bad: "x" }, categoryOrderManual: ["auto:produce"] },
      items: [
        { id: "item-1", name: "Milk", quantity: 2, unit: "l", purchased: false, note: null, inventoryItemId: "inv-1" },
        { id: "item-2", name: "Avocado", quantity: 3, unit: "pcs", purchased: false, note: "Ripe ones", inventoryItemId: null },
      ],
    });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-1", category: "Dairy & eggs" }]);

    const result = await getShoppingListByShareToken("active-token");

    expect(result).toEqual({
      id: "list-1",
      name: "Weekly shop",
      // UX-63: who shared it, and the store order the aisles follow.
      householdName: "The Smiths",
      storeOrder: { learned: { "auto:dairy": 0.2 }, manual: ["auto:produce"] },
      items: [
        { id: "item-1", name: "Milk", quantity: 2, unit: "l", purchased: false, note: null, category: "Dairy & eggs" },
        // GAP-5: the note reaches link holders too.
        { id: "item-2", name: "Avocado", quantity: 3, unit: "pcs", purchased: false, note: "Ripe ones", category: null },
      ],
    });
    // The category lookup is scoped to the list's own household.
    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["inv-1"] }, householdId: "hh-1" } }),
    );
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
      unit: "pcs",
      estimatedPrice: 25,
      inventoryItem: { id: "inv-1", quantity: 2, lowStockThreshold: 1 },
    });
    shoppingListFindUniqueMock.mockResolvedValue({ householdId: "household-1" });
    shoppingListItemCountMock.mockResolvedValue(2);

    const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      // AUTO-9: share-link ticks teach the store order too. ON_CHECK (the
      // list's household has no inventorySyncMode set here): the tick is the
      // arrival, so the row is put away in the same write. No
      // checkedOffByUserId — a link holder has no account.
      data: {
        purchased: true,
        checkedOffAt: expect.any(Date),
        putAwayAt: expect.any(Date),
        priceRecordedAt: expect.any(Date),
      },
    });
    // AUTO-8: same call site as the out-of-stock check, scoped to the
    // list's own household (never anything from the visitor).
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "inv-1", 2, 5);
    // AUTO-4: this purchase's price also becomes the item's lastKnownPrice,
    // per unit (BUG-3): 25 for the row's 3 is 25 / 3 each.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 5, lastKnownPrice: 25 / 3 },
    });
    // No acting user to exclude from the push — no account behind a link.
    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(
      expect.anything(),
      "household-1",
      "inv-1",
      2,
      5,
      undefined,
    );
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 25, quantity: 3, unit: "pcs" },
    });
    // GAP-9: the list's own household again, and no acting user to exclude
    // from the push — a share-link visitor has no account.
    expect(recordPriceSpikesMock).toHaveBeenCalledWith("household-1", [
      { priceHistoryId: "ph-1", inventoryItemId: "inv-1", price: 25, quantity: 3, unit: "pcs" },
    ]);
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
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
    });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    expect(recordPriceSpikesMock).not.toHaveBeenCalled();
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

  describe("put-away mode (ON_PUT_AWAY)", () => {
    function setUp(item: Record<string, unknown>) {
      shareLinkFindUniqueMock.mockResolvedValue({ id: "link-1", shoppingListId: "list-1", revokedAt: null });
      shoppingListItemFindFirstMock.mockResolvedValue({
        id: "item-1",
        shoppingListId: "list-1",
        quantity: 3,
        unit: "pcs",
        estimatedPrice: 25,
        inventoryItem: { id: "inv-1", quantity: 0 },
        ...item,
      });
      shoppingListFindUniqueMock.mockResolvedValue({
        householdId: "household-1",
        household: { inventorySyncMode: "ON_PUT_AWAY" },
      });
    }

    it("ticking leaves inventory alone until the household puts it away", async () => {
      setUp({ purchased: false, putAwayAt: null });

      const result = await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

      expect(result).toEqual({});
      expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { purchased: true, checkedOffAt: expect.any(Date), putAwayAt: null },
      });
      expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
      expect(priceHistoryCreateMock).not.toHaveBeenCalled();
      expect(recordOutOfStockTransitionMock).not.toHaveBeenCalled();
      expect(addToDefaultListOnLowStockMock).not.toHaveBeenCalled();
      expect(recordListClearedTransitionMock).toHaveBeenCalled();
    });

    it("un-ticking a row nobody put away yet has nothing to reverse", async () => {
      setUp({ purchased: true, putAwayAt: null });

      await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

      expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
      expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
        where: { id: "item-1" },
        data: { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
      });
    });

    it("un-ticking a row already put away gives its stock back, for the token's own household", async () => {
      setUp({ purchased: true, putAwayAt: new Date("2026-09-01"), inventoryItem: { id: "inv-1", quantity: 5 } });

      await toggleItemViaShareTokenAction("valid-token-for-list-1", "item-1");

      expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { quantity: 2 } });
      expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "inv-1", 5, 2);
    });
  });
});
