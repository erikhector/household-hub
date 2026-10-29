// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of ticking rows off, offline replay and put-away in
// src/app/dashboard/shopping-list/purchase-actions.ts, indirectly through the
// exported Server Actions. MAINT-3 split these out of the old actions.test.ts. All I/O (Prisma, requireHousehold, next/cache,
// next/navigation, i18n, exchange-rate) is mocked — no database or network
// call is made. See REQUIREMENTS.md's "Testing" section and the identical
// convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  shoppingListCreateMock,
  shoppingListTemplateFindFirstMock,
  shoppingListFindFirstMock,
  shoppingListUpdateManyMock,
  shoppingListUpdateMock,
  shoppingListDeleteManyMock,
  inventoryItemFindFirstMock,
  inventoryItemFindManyMock,
  inventoryItemCreateMock,
  inventoryItemUpdateMock,
  inventoryItemUpdateManyMock,
  shoppingListItemFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateMock,
  shoppingListItemCreateManyMock,
  shoppingListItemUpdateMock,
  shoppingListItemDeleteMock,
  shoppingListItemCountMock,
  shoppingListFindUniqueMock,
  priceHistoryCreateMock,
  recordPriceSpikesMock,
  transactionCreateMock,
  transactionDeleteManyMock,
  transactionMock,
  notificationFindFirstMock,
  notificationCreateMock,
  inventoryItemFindUniqueMock,
  resolveShoppingExpenseCategoryMock,
  fetchExchangeRateMock,
  redirectMock,
  revalidatePathMock,
  shoppingListItemDeleteManyMock,
  getOrCreateDefaultShoppingListMock,
  addToDefaultListOnLowStockMock,
  householdUpdateMock,
  txShoppingListItemFindManyMock,
  notificationUpdateManyMock,
  txShoppingListItemUpdateManyMock,
  txShoppingListItemFindUniqueMock,
  itemAliasFindManyMock,
  itemAliasUpsertMock,
} = vi.hoisted(() => ({
  // MATCH-5: no learned aliases unless a test sets some.
  itemAliasFindManyMock: vi.fn(async () => [] as { normalizedName: string; inventoryItemId: string | null }[]),
  itemAliasUpsertMock: vi.fn(async () => ({})),
  requireHouseholdMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListTemplateFindFirstMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListUpdateManyMock: vi.fn(),
  shoppingListUpdateMock: vi.fn(),
  shoppingListDeleteManyMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  inventoryItemCreateMock: vi.fn(),
  inventoryItemUpdateMock: vi.fn(),
  inventoryItemUpdateManyMock: vi.fn(),
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  shoppingListItemCreateManyMock: vi.fn(),
  shoppingListItemUpdateMock: vi.fn(),
  shoppingListItemDeleteMock: vi.fn(),
  shoppingListItemCountMock: vi.fn(async () => 0),
  shoppingListFindUniqueMock: vi.fn(),
  // Returns a row id so the actions can hand it to recordPriceSpikes (GAP-9).
  priceHistoryCreateMock: vi.fn(async (args: { data: { inventoryItemId: string } }) => ({
    id: `ph-${args.data.inventoryItemId}`,
  })),
  recordPriceSpikesMock: vi.fn(async () => {}),
  // Defaults so every receipt/completion test gets a well-formed expense row
  // (MAINT-5 logs it inside the transaction, where a malformed one would
  // roll the whole thing back); tests override with mock*Once.
  transactionCreateMock: vi.fn(async (): Promise<{ id?: string }> => ({ id: "txn-1" })),
  transactionDeleteManyMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      shoppingListItem: {
        create: shoppingListItemCreateMock,
        update: shoppingListItemUpdateMock,
        delete: shoppingListItemDeleteMock,
        count: shoppingListItemCountMock,
        // The incoming-stock check behind the out-of-stock alert
        // (src/lib/incoming-stock.ts) — its own mock so it never collides
        // with the non-transactional findMany results a test sets up.
        findMany: txShoppingListItemFindManyMock,
        // The claim-then-re-read that putAwayItemsAction and
        // applyReceiptScanAction do inside their transaction (see
        // freshRowFromFixtures below).
        updateMany: txShoppingListItemUpdateManyMock,
        findUnique: txShoppingListItemFindUniqueMock,
      },
      shoppingList: {
        create: shoppingListCreateMock,
        findUnique: shoppingListFindUniqueMock,
        update: shoppingListUpdateMock,
      },
      // MAINT-5: the shopping expense is logged inside the transaction.
      transaction: { create: transactionCreateMock, deleteMany: transactionDeleteManyMock },
      inventoryItem: {
        update: inventoryItemUpdateMock,
        findUnique: inventoryItemFindUniqueMock,
        findFirst: inventoryItemFindFirstMock,
        create: inventoryItemCreateMock,
      },
      priceHistory: { create: priceHistoryCreateMock },
      itemAlias: { upsert: itemAliasUpsertMock },
      notification: {
        findFirst: notificationFindFirstMock,
        create: notificationCreateMock,
        updateMany: notificationUpdateManyMock,
      },
    };
    return cb(tx);
  }),
  resolveShoppingExpenseCategoryMock: vi.fn(async (): Promise<{ id: string; name?: string }> => ({ id: "cat-groceries", name: "Groceries" })),
  fetchExchangeRateMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
  shoppingListItemDeleteManyMock: vi.fn(),
  getOrCreateDefaultShoppingListMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(),
  householdUpdateMock: vi.fn(),
  txShoppingListItemFindManyMock: vi.fn(async () => [] as unknown[]),
  notificationUpdateManyMock: vi.fn(async () => ({ count: 0 })),
  // Every claim succeeds unless a test says otherwise.
  txShoppingListItemUpdateManyMock: vi.fn(async () => ({ count: 1 })),
  txShoppingListItemFindUniqueMock: vi.fn(),
}));

// The in-transaction re-read of a row returns whatever fixture the test set
// up for it — a receipt test's list items, or a put-away test's rows —
// unless a test queues something fresher with mockResolvedValueOnce.
async function freshRowFromFixtures({ where }: { where: { id: string } }) {
  const sources = [
    ...shoppingListFindFirstMock.mock.results,
    ...shoppingListItemFindManyMock.mock.results,
  ].reverse();
  for (const result of sources) {
    const value = await result.value;
    const rows = Array.isArray(value) ? value : value?.items;
    const hit = Array.isArray(rows) ? rows.find((row: { id: string }) => row.id === where.id) : undefined;
    if (hit) return hit;
  }
  return null;
}
txShoppingListItemFindUniqueMock.mockImplementation(freshRowFromFixtures);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingList: {
      create: shoppingListCreateMock,
      findFirst: shoppingListFindFirstMock,
      updateMany: shoppingListUpdateManyMock,
      update: shoppingListUpdateMock,
      deleteMany: shoppingListDeleteManyMock,
    },
    inventoryItem: {
      findFirst: inventoryItemFindFirstMock,
      findMany: inventoryItemFindManyMock,
      create: inventoryItemCreateMock,
      update: inventoryItemUpdateMock,
      updateMany: inventoryItemUpdateManyMock,
    },
    shoppingListTemplate: { findFirst: shoppingListTemplateFindFirstMock },
    shoppingListItem: {
      findFirst: shoppingListItemFindFirstMock,
      findMany: shoppingListItemFindManyMock,
      create: shoppingListItemCreateMock,
      createMany: shoppingListItemCreateManyMock,
      update: shoppingListItemUpdateMock,
      delete: shoppingListItemDeleteMock,
      deleteMany: shoppingListItemDeleteManyMock,
    },
    priceHistory: { create: priceHistoryCreateMock },
    transaction: { create: transactionCreateMock },
    household: { update: householdUpdateMock },
    itemAlias: { findMany: itemAliasFindManyMock, upsert: itemAliasUpsertMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => ({
  getDictionary: vi.fn(async () => ({
    inventory: {
      uncategorized: "Uncategorized",
      autoCategories: (await import("@/lib/i18n/dictionaries/en")).en.inventory.autoCategories },
    shoppingList: {
      defaultNamePrefix: "Shopping list",
      expenseDescription: "Groceries: {name}",
      expenseLogged: "Logged {amount} to {category}",
      unresolvedNotice: {
        one: "{count} item wasn't linked",
        other: "{count} items weren't linked",
      },
      registerReceipt: {
        namePlaceholderPrefix: "Receipt",
      },
    },
  })),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("@/lib/i18n/format", async (importOriginal) => ({
  datedName: (await importOriginal<typeof import("@/lib/i18n/format")>()).datedName,
  format: (template: string, vars: Record<string, string>) =>
    template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? "")),
  plural: (count: number, forms: { one: string; other: string }) => (count === 1 ? forms.one : forms.other),
}));
vi.mock("@/lib/budget-groceries-category", () => ({
  resolveShoppingExpenseCategory: resolveShoppingExpenseCategoryMock,
}));
vi.mock("@/lib/exchange-rate", () => ({ fetchExchangeRate: fetchExchangeRateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
// GAP-9: recordPriceSpikes has its own unit (src/lib/notifications.test.ts);
// here we only check each PriceHistory writer hands it what it wrote. The
// rest of the module stays real, since the LIST_CLEARED/OUT_OF_STOCK
// assertions below go through it.
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  recordPriceSpikes: recordPriceSpikesMock,
}));
// AUTO-8's helpers have their own unit (src/lib/shopping/default-list.test.ts);
// here we only check the actions call them at the right moments.
vi.mock("@/lib/shopping/default-list", () => ({
  getOrCreateDefaultShoppingList: getOrCreateDefaultShoppingListMock,
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  revalidateAutoAdded: vi.fn(),
}));

const {
  togglePurchasedAction,
  replayTickAction,
  putAwayItemsAction,
} = await import("@/app/dashboard/shopping-list/purchase-actions");

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

describe("replayTickAction", () => {
  const row = (purchased: boolean) => ({
    id: "item-1",
    shoppingListId: "list-1",
    purchased,
    quantity: 1,
    estimatedPrice: null,
    inventoryItem: null,
  });

  it("skips a row that is gone (deleted meanwhile, or not this household's) without an error", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await replayTickAction("item-1", true);

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("does nothing when the row already has the wanted state", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(row(true));

    const result = await replayTickAction("item-1", true);

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("ticks a row that differs from the wish", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(row(false));

    await replayTickAction("item-1", true);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: expect.objectContaining({ purchased: true }) }),
    );
  });

  it("unticks a row that differs from the wish", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(row(true));

    await replayTickAction("item-1", false);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1" }, data: expect.objectContaining({ purchased: false }) }),
    );
  });

  it("looks the row up scoped to the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    await replayTickAction("item-1", true);

    expect(shoppingListItemFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-1", shoppingList: { householdId: "household-1" } } }),
    );
  });
});

describe("togglePurchasedAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await togglePurchasedAction("someone-elses-item");

    expect(result.error).toBe("Item not found");
  });

  it("marking purchased increases linked inventory quantity and logs a price history entry", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 3,
      unit: "pcs",
      estimatedPrice: 25,
      inventoryItem: { id: "inv-1", quantity: 2 },
    });

    await togglePurchasedAction("item-1");

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      // AUTO-9: the tick is timestamped for store-order learning, and
      // attributed for the put-away reminder. ON_CHECK (the household
      // fixture predates inventorySyncMode): the tick is the arrival, so the
      // row is put away and its price recorded in the same write.
      data: {
        purchased: true,
        checkedOffAt: expect.any(Date),
        checkedOffByUserId: "user-1",
        putAwayAt: expect.any(Date),
        priceRecordedAt: expect.any(Date),
      },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      // AUTO-4: this purchase's price also becomes the item's lastKnownPrice,
      // per unit (BUG-3): 25 for 3 is 25 / 3 each.
      data: { quantity: 5, lastKnownPrice: 25 / 3 },
    });
    // GAP-9: with the line's quantity/unit, then checked for a price spike
    // once the transaction has committed, excluding the acting user's push.
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 25, quantity: 3, unit: "pcs" },
    });
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      [{ priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 25, quantity: 3, unit: "pcs" }],
      "user-1",
    );
    // Only pending item on the list — checking it off crosses pending
    // count from 1 to 0, firing a LIST_CLEARED notification.
    expect(shoppingListItemCountMock).toHaveBeenCalledWith({
      where: { shoppingListId: "list-1", purchased: false },
    });
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "LIST_CLEARED", shoppingListId: "list-1" },
    });
  });

  it("does not fire LIST_CLEARED while other pending items remain", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 3,
      estimatedPrice: null,
      inventoryItem: null,
    });
    shoppingListItemCountMock.mockResolvedValueOnce(2);

    await togglePurchasedAction("item-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("un-marking purchased decreases linked inventory quantity, floored at zero", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      quantity: 10,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });

    await togglePurchasedAction("item-1");

    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 0 },
    });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    // AUTO-9: an un-tick clears its step from the check-off sequence, so a
    // mistaken tick never teaches the store order anything.
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
    });
  });

  it("only stamps priceRecordedAt when a PriceHistory row was really written", async () => {
    // Priced but unlinked: no PriceHistory is possible, so no stamp.
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      unit: "pcs",
      estimatedPrice: 12,
      inventoryItem: null,
    });

    await togglePurchasedAction("item-1");

    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    const [[{ data }]] = shoppingListItemUpdateMock.mock.calls;
    expect(data).not.toHaveProperty("priceRecordedAt");
    expect(data.putAwayAt).toBeInstanceOf(Date);
  });

  // AUTO-7
  it("marking purchased crosses 0→>0 and estimates an expiry for a category with a known shelf life", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 0,
        category: "Dairy & eggs",
        expiresAt: null,
        expiresAtEstimated: false,
        shelfLifeDays: null,
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  // GAP-28
  it("restocking an opened item from zero clears openedAt and re-estimates the old pack's opened date", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 0,
        category: "Dairy & eggs",
        expiresAt: new Date("2026-06-01"),
        expiresAtEstimated: true,
        shelfLifeDays: null,
        openedAt: new Date("2026-05-29"),
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.openedAt).toBeNull();
    // The estimator's fresh date wins over the cleared one.
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.expiresAt).not.toEqual(new Date("2026-06-01"));
  });

  it("restocking an opened item from zero clears its estimated date when there's nothing to re-estimate from", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 0,
        category: "Pantry basics",
        expiresAt: new Date("2026-06-01"),
        expiresAtEstimated: true,
        shelfLifeDays: null,
        openedAt: new Date("2026-05-29"),
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data).toEqual(expect.objectContaining({ openedAt: null, expiresAt: null, expiresAtEstimated: false }));
  });

  it("topping up an opened item that hasn't run out keeps it opened", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 1,
        category: "Dairy & eggs",
        expiresAt: new Date("2026-06-01"),
        expiresAtEstimated: true,
        shelfLifeDays: null,
        openedAt: new Date("2026-05-29"),
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data).not.toHaveProperty("openedAt");
    expect(data).not.toHaveProperty("expiresAt");
  });

  it("never overwrites a real (user-entered) expiry when marking purchased", async () => {
    const realDate = new Date("2026-06-01");
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 0,
        category: "Dairy & eggs",
        expiresAt: realDate,
        expiresAtEstimated: false,
        shelfLifeDays: null,
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAt).toBeUndefined();
    expect(data.expiresAtEstimated).toBeUndefined();
  });

  it("does not estimate an expiry for a category with no default shelf life", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      quantity: 1,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 0,
        category: "Pantry basics",
        expiresAt: null,
        expiresAtEstimated: false,
        shelfLifeDays: null,
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAt).toBeUndefined();
  });

  it("un-marking purchased never estimates an expiry (it's not a stock arrival)", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      quantity: 3,
      estimatedPrice: null,
      inventoryItem: {
        id: "inv-1",
        quantity: 3,
        category: "Dairy & eggs",
        expiresAt: null,
        expiresAtEstimated: false,
        shelfLifeDays: null,
      },
    });

    await togglePurchasedAction("item-1");

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAt).toBeUndefined();
  });

  it("un-marking runs the low-stock auto-add inside the transaction and returns what it added (AUTO-8)", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      quantity: 10,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });
    const autoAdded = { shoppingListItemId: "row-9", listId: "default", listName: "Next shop", itemName: "Milk" };
    addToDefaultListOnLowStockMock.mockResolvedValueOnce(autoAdded);

    const result = await togglePurchasedAction("item-1");

    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "inv-1", 4, 0);
    expect(result).toEqual({ autoAdded: [autoAdded] });
  });
});

describe("togglePurchasedAction — put-away mode (ON_PUT_AWAY)", () => {
  const putAwayHousehold = { id: "household-1", inventorySyncMode: "ON_PUT_AWAY" };

  function asPutAwayHousehold() {
    requireHouseholdMock.mockResolvedValue({ household: putAwayHousehold, userId: "user-1" });
  }

  it("ticking only marks the row in the cart — no inventory, price or expiry writes", async () => {
    asPutAwayHousehold();
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: false,
      putAwayAt: null,
      quantity: 3,
      unit: "pcs",
      estimatedPrice: 25,
      inventoryItem: { id: "inv-1", quantity: 0, category: "Dairy & eggs", expiresAt: null, expiresAtEstimated: false },
    });

    await togglePurchasedAction("item-1");

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      // putAwayAt: null is a defensive reset — a row never enters the cart
      // already looking put away.
      data: { purchased: true, checkedOffAt: expect.any(Date), checkedOffByUserId: "user-1", putAwayAt: null },
    });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    expect(addToDefaultListOnLowStockMock).not.toHaveBeenCalled();
    expect(recordPriceSpikesMock).toHaveBeenCalledWith("household-1", [], "user-1");
    // "The shopping is done" is still about the list, not the pantry.
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "LIST_CLEARED", shoppingListId: "list-1" },
    });
  });

  it("un-ticking a row that was never put away has nothing to reverse, and forgets its recorded price", async () => {
    asPutAwayHousehold();
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      putAwayAt: null,
      priceRecordedAt: new Date("2026-09-26"),
      quantity: 3,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });

    await togglePurchasedAction("item-1");

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
    });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(addToDefaultListOnLowStockMock).not.toHaveBeenCalled();
  });

  it("un-ticking a row that was already put away gives its stock back", async () => {
    asPutAwayHousehold();
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      putAwayAt: new Date("2026-09-01"),
      quantity: 3,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });

    await togglePurchasedAction("item-1");

    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { quantity: 1 } });
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "inv-1", 4, 1);
  });

  it("in ON_CHECK mode, un-ticking a row left over from put-away mode doesn't take stock it never added", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      purchased: true,
      putAwayAt: null,
      quantity: 3,
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 4 },
    });

    await togglePurchasedAction("item-1");

    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
  });
});

describe("putAwayItemsAction", () => {
  const dairy = {
    category: "Dairy & eggs",
    expiresAt: null,
    expiresAtEstimated: false,
    shelfLifeDays: null,
    openedAt: null,
  };

  function row(overrides: Record<string, unknown>) {
    return {
      id: "sli-1",
      shoppingListId: "list-1",
      purchased: true,
      putAwayAt: null,
      priceRecordedAt: null,
      quantity: 2,
      unit: "l",
      estimatedPrice: null,
      inventoryItem: { id: "inv-1", quantity: 0, ...dairy },
      ...overrides,
    };
  }

  // The pre-transaction read (tenancy) and the in-transaction re-read both
  // see these rows — see freshRowFromFixtures.
  function withRows(...rows: ReturnType<typeof row>[]) {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    shoppingListItemFindManyMock.mockResolvedValue(rows);
  }

  it("refuses a list that isn't this household's (or is archived) before reading any rows", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await putAwayItemsAction("someone-elses-list", [{ itemId: "sli-1" }]);

    expect(result.error).toBe("This list can't be edited right now");
    expect(shoppingListFindFirstMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-list", householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { id: true },
    });
    expect(shoppingListItemFindManyMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("fails the whole call when any item isn't on this list (IDOR guard)", async () => {
    withRows(row({}));

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1" }, { itemId: "someone-elses-row" }]);

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["sli-1", "someone-elses-row"] }, shoppingListId: "list-1" },
      select: { id: true },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1", quantity: 0 }]);

    expect(result.error).toBe("Quantity must be greater than 0");
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
  });

  it("claims each row inside the transaction before moving any stock", async () => {
    withRows(row({}));

    await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "sli-1", shoppingListId: "list-1", purchased: true, putAwayAt: null },
      data: { putAwayAt: expect.any(Date) },
    });
    // Re-read after the claim, inside the transaction.
    expect(txShoppingListItemFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      include: { inventoryItem: true },
    });
  });

  it("skips a row another put-away (or an un-tick) claimed first — its stock is never counted twice", async () => {
    withRows(row({}));
    txShoppingListItemUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(result).toEqual({ putAway: 0, notBought: 0 });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("puts away by the confirmed quantity with every arrival side effect, pricing the listed quantity", async () => {
    withRows(row({ estimatedPrice: 18 }));
    // Another ticked row is still waiting on the list, so it stays open.
    shoppingListItemCountMock.mockResolvedValueOnce(1);

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1", quantity: 3 }]);

    expect(result).toEqual({ putAway: 1, notBought: 0 });
    // The row records what came home, so a later un-tick gives back 3.
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      data: { quantity: 3, priceRecordedAt: expect.any(Date) },
    });
    const [[{ where, data }]] = inventoryItemUpdateMock.mock.calls;
    expect(where).toEqual({ id: "inv-1" });
    expect(data).toEqual(
      expect.objectContaining({ quantity: 3, lastKnownPrice: 9, expiresAtEstimated: true, expiresAt: expect.any(Date) }),
    );
    // 18 was paid for the listed 2 l — recorded against 2, so the unit price
    // (9/l) isn't distorted to 6/l by the corrected quantity and no false
    // price jump is checked for.
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 18, quantity: 2, unit: "l" },
    });
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "inv-1", 0, 3);
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      [{ priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 18, quantity: 2, unit: "l" }],
      "user-1",
    );
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("uses a typed best-before date as a real one and sets the location", async () => {
    withRows(row({}));

    await putAwayItemsAction("list-1", [{ itemId: "sli-1", expiresAt: "2026-10-01", location: "Fridge" }]);

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data).toEqual(
      expect.objectContaining({
        quantity: 2,
        location: "Fridge",
        expiresAt: new Date("2026-10-01"),
        expiresAtEstimated: false,
      }),
    );
  });

  it("\"not bought\" un-ticks the row, forgets its recorded price and leaves inventory alone", async () => {
    withRows(row({ priceRecordedAt: new Date("2026-09-26") }));

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1", notBought: true }]);

    expect(result).toEqual({ putAway: 0, notBought: 1 });
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "sli-1", shoppingListId: "list-1", purchased: true, putAwayAt: null },
      data: { purchased: false, checkedOffAt: null, checkedOffByUserId: null, priceRecordedAt: null },
    });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
  });

  it("doesn't record a price a receipt already recorded", async () => {
    withRows(row({ estimatedPrice: 18, priceRecordedAt: new Date("2026-09-26") }));

    await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data).not.toHaveProperty("lastKnownPrice");
    expect(data.quantity).toBe(2);
  });

  it("builds each row on the inventory item as re-read inside the transaction", async () => {
    withRows(row({ id: "sli-1", quantity: 2 }), row({ id: "sli-2", quantity: 1 }));
    // What the database returns after the first row's write, inside the
    // same transaction: the item already holds the first row's 2.
    txShoppingListItemFindUniqueMock
      .mockResolvedValueOnce(row({ id: "sli-1", quantity: 2 }))
      .mockResolvedValueOnce(row({ id: "sli-2", quantity: 1, inventoryItem: { id: "inv-1", quantity: 2, ...dairy } }));

    await putAwayItemsAction("list-1", [{ itemId: "sli-1" }, { itemId: "sli-2" }]);

    expect(inventoryItemUpdateMock.mock.calls.map(([args]) => args.data.quantity)).toEqual([2, 3]);
  });

  it("dismisses the list's reminder once nothing waits", async () => {
    withRows(row({}));

    await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", shoppingListId: "list-1", kind: "PUT_AWAY_REMINDER", dismissedAt: null },
      data: { dismissedAt: expect.any(Date) },
    });
  });

  it("puts an unlinked row away without any stock to add", async () => {
    withRows(row({ inventoryItem: null, estimatedPrice: 9 }));

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(result.putAway).toBe(1);
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("puts away rows ticked in put-away mode after the household switched back to ON_CHECK", async () => {
    // The default household fixture has no inventorySyncMode (ON_CHECK); the
    // row was ticked earlier under ON_PUT_AWAY and never put away.
    withRows(row({ estimatedPrice: 20, checkedOffAt: new Date("2026-09-25") }));

    const result = await putAwayItemsAction("list-1", [{ itemId: "sli-1" }]);

    expect(result.putAway).toBe(1);
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1" }, data: expect.objectContaining({ quantity: 2 }) }),
    );
    expect(priceHistoryCreateMock).toHaveBeenCalledTimes(1);
  });
});
