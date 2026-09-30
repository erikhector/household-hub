// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects in
// src/app/dashboard/shopping-list/actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache,
// next/navigation, i18n, exchange-rate) is mocked — no database or network
// call is made. See REQUIREMENTS.md's "Testing" section and the identical
// convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  shoppingListCreateMock,
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
vi.mock("@/lib/i18n/format", () => ({
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
  createShoppingListAction,
  archiveShoppingListAction,
  deleteShoppingListAction,
  generateFromLowStockAction,
  addAdHocItemAction,
  quickAddShoppingListItemAction,
  importShoppingListItemsAction,
  smartAddShoppingListItemsAction,
  linkShoppingListItemAction,
  createInventoryItemFromShoppingListItemAction,
  updateShoppingListItemAction,
  updateShoppingListItemPriceAction,
  unlinkShoppingListItemAction,
  setShoppingListItemCategoryAction,
  resolveShoppingListMappingsAction,
  togglePurchasedAction,
  putAwayItemsAction,
  applyReceiptScanAction,
  deleteShoppingListItemAction,
  completeShoppingListAction,
  uncompleteShoppingListAction,
  registerReceiptAction,
  undoAutoAddedItemsAction,
  saveCategoryOrderAction,
  resetCategoryOrderAction,
} = await import("@/app/dashboard/shopping-list/actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

describe("createShoppingListAction validation (createListSchema)", () => {
  it("rejects a name over 120 characters", async () => {
    const result = await createShoppingListAction({}, formData({ name: "x".repeat(121) }));
    expect(result.error).toBe("List name must be 120 characters or fewer");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
  });

  it("falls back to a default name when none is given, and redirects to the new list", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1" });

    await expect(createShoppingListAction({}, formData({}))).rejects.toThrow(
      "REDIRECT:/dashboard/shopping-list/list-1",
    );

    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          householdId: "household-1",
          name: expect.stringContaining("Shopping list"),
        }),
      }),
    );
  });
});

describe("household-scoping (IDOR) guards on id-targeted actions", () => {
  it("archiveShoppingListAction scopes the update to the caller's household", async () => {
    shoppingListUpdateManyMock.mockResolvedValue({ count: 0 });

    await archiveShoppingListAction("someone-elses-list");

    expect(shoppingListUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "someone-elses-list", householdId: "household-1" },
      }),
    );
  });

  it("archiveShoppingListAction un-defaults the list so un-archiving can't create a second default (AUTO-8)", async () => {
    shoppingListUpdateManyMock.mockResolvedValue({ count: 1 });

    await archiveShoppingListAction("list-1");

    expect(shoppingListUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED", isDefault: false }) }),
    );
  });

  it("deleteShoppingListAction scopes the delete to the caller's household", async () => {
    shoppingListDeleteManyMock.mockResolvedValue({ count: 0 });

    await expect(deleteShoppingListAction("someone-elses-list")).rejects.toThrow(
      "REDIRECT:/dashboard/shopping-list",
    );

    expect(shoppingListDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-list", householdId: "household-1" },
    });
  });

  it("generateFromLowStockAction refuses when the list isn't active/owned by the caller's household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await generateFromLowStockAction("someone-elses-list");

    expect(result.error).toBe("This list can't be edited right now");
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });
});

describe("generateFromLowStockAction", () => {
  it("reports how many low-stock items it added, so the caller can toast a count", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 1, lowStockThreshold: 3, unit: "l" },
      { id: "inv-2", name: "Eggs", quantity: 5, lowStockThreshold: 2, unit: "pcs" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ inventoryItemId: "inv-1", name: "Milk" }),
      ],
    });
  });

  it("reports 0 added (not an error) when nothing is low on stock", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 5, lowStockThreshold: 2, unit: "l" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(0);
    expect(result.error).toBeUndefined();
    expect(shoppingListItemCreateManyMock).not.toHaveBeenCalled();
  });

  it("defaults each added row's estimatedPrice from its lastKnownPrice (AUTO-4)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 1, lowStockThreshold: 3, unit: "l", lastKnownPrice: 22 },
      { id: "inv-2", name: "Eggs", quantity: 0, lowStockThreshold: 2, unit: "pcs", lastKnownPrice: null },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 2 });

    await generateFromLowStockAction("list-1");

    const rows = shoppingListItemCreateManyMock.mock.calls[0][0].data;
    expect(rows.find((r: { inventoryItemId: string }) => r.inventoryItemId === "inv-1").estimatedPrice).toBe(22);
    expect(rows.find((r: { inventoryItemId: string }) => r.inventoryItemId === "inv-2").estimatedPrice).toBeUndefined();
  });
});

describe("addAdHocItemAction / quickAddShoppingListItemAction (shared createAdHocShoppingListItem)", () => {
  it("rejects a zero quantity", async () => {
    const result = await addAdHocItemAction(
      {},
      formData({ listId: "list-1", name: "Milk", quantity: "0" }),
    );
    expect(result.error).toBe("Quantity must be greater than 0");
  });

  it("refuses to add to a list from another household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await addAdHocItemAction(
      {},
      formData({ listId: "someone-elses-list", name: "Milk", quantity: "1" }),
    );

    expect(result.error).toBe("This list can't be edited right now");
    expect(shoppingListItemCreateMock).not.toHaveBeenCalled();
  });

  it("auto-links to an inventory item on an exact case-insensitive name match, and reports the link", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "milk" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await addAdHocItemAction({}, formData({ listId: "list-1", name: "Milk", quantity: "1" }));

    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: { shoppingListId: "list-1", inventoryItemId: "inv-1", name: "Milk", quantity: 1, unit: "pcs" },
    });
    expect(result.autoLinkedName).toBe("milk");
    // An exact match already resolved it — no need to fetch every inventory
    // item just to try the fuzzy fallback too.
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });

  it("defaults estimatedPrice from the linked item's lastKnownPrice (AUTO-4)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "milk", lastKnownPrice: 18.5 });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await addAdHocItemAction({}, formData({ listId: "list-1", name: "Milk", quantity: "1" }));

    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ estimatedPrice: 18.5 }),
    });
  });

  it("leaves estimatedPrice unset when the linked item has no lastKnownPrice yet", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "milk", lastKnownPrice: null });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await addAdHocItemAction({}, formData({ listId: "list-1", name: "Milk", quantity: "1" }));

    const data = shoppingListItemCreateMock.mock.calls[0][0].data;
    expect(data.estimatedPrice).toBeUndefined();
  });

  it("falls back to a single confident fuzzy match when there's no exact match", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", unit: "l" },
      { id: "inv-2", name: "Bread", unit: "pcs" },
    ]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await addAdHocItemAction({}, formData({ listId: "list-1", name: "Milk 1L", quantity: "1" }));

    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: { shoppingListId: "list-1", inventoryItemId: "inv-1", name: "Milk 1L", quantity: 1, unit: "l" },
    });
    expect(result.autoLinkedName).toBe("Milk");
  });

  it("leaves the item unlinked when two candidates both score above the fuzzy match threshold", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    // Both "Tomato" and "Tomatoes" are near-identical to the misspelled
    // query — with two strong candidates, guessing which one is right isn't
    // safe, so this should leave the item unlinked rather than pick one.
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Tomato", unit: "pcs" },
      { id: "inv-2", name: "Tomatoes", unit: "pcs" },
    ]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await addAdHocItemAction({}, formData({ listId: "list-1", name: "Tomatoe", quantity: "1" }));

    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: { shoppingListId: "list-1", inventoryItemId: null, name: "Tomatoe", quantity: 1, unit: "pcs" },
    });
    expect(result.autoLinkedName).toBeUndefined();
  });

  it("quickAddShoppingListItemAction returns the created item's id/name for the caller to use immediately", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-9", name: "Eggs" });

    const result = await quickAddShoppingListItemAction("list-1", "Eggs", 2);

    expect(result).toEqual({ item: { id: "item-9", name: "Eggs" } });
    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
  });

  it("quickAddShoppingListItemAction with newItemDetails creates a new inventory item (category/unit) and links it when there's no exact-name match", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-9", name: "Kycklingfilé" });

    const result = await quickAddShoppingListItemAction("list-1", "Kycklingfilé", 0.556, {
      category: "Meat",
      unit: "kg",
    });

    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "Kycklingfilé",
        category: "Meat",
        unit: "kg",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        inventoryItemId: "inv-new",
        name: "Kycklingfilé",
        quantity: 0.556,
        unit: "kg",
      },
    });
    expect(result).toEqual({ item: { id: "item-9", name: "Kycklingfilé" } });
  });

  it("quickAddShoppingListItemAction with newItemDetails still links the exact-name match instead of creating a duplicate", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-existing" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-9", name: "Milk" });

    await quickAddShoppingListItemAction("list-1", "Milk", 1, { category: "Dairy", unit: "l" });

    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: { shoppingListId: "list-1", inventoryItemId: "inv-existing", name: "Milk", quantity: 1, unit: "l" },
    });
  });
});

describe("importShoppingListItemsAction", () => {
  it("rejects an empty items array", async () => {
    const result = await importShoppingListItemsAction("list-1", []);

    expect(result.error).toBeTruthy();
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
  });

  it("refuses to import into a list from another household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await importShoppingListItemsAction("someone-elses-list", [{ name: "Milk", quantity: 1 }]);

    expect(result.error).toBe("This list can't be edited right now");
    expect(shoppingListItemCreateManyMock).not.toHaveBeenCalled();
  });

  it("fetches inventory once and auto-links each row by exact or single-fuzzy match, in one createMany call", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", unit: "l" },
      { id: "inv-2", name: "Bread", unit: "pcs" },
    ]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await importShoppingListItemsAction("list-1", [
      { name: "Milk", quantity: 1 },
      { name: "Mystery item", quantity: 2, unit: "kg" },
    ]);

    expect(inventoryItemFindManyMock).toHaveBeenCalledTimes(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        { shoppingListId: "list-1", inventoryItemId: "inv-1", name: "Milk", quantity: 1, unit: "l" },
        { shoppingListId: "list-1", inventoryItemId: null, name: "Mystery item", quantity: 2, unit: "kg" },
      ],
    });
    expect(result).toEqual({ added: 2 });
  });

  it("links a row through the household's learned alias, but not an untracked one (MATCH-5)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-egg", name: "Egg", unit: "pcs" }]);
    itemAliasFindManyMock.mockResolvedValueOnce([
      { normalizedName: "eggs", inventoryItemId: "inv-egg" },
      { normalizedName: "water", inventoryItemId: null },
    ]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 2 });

    await importShoppingListItemsAction("list-1", [
      { name: "eggs", quantity: 6 },
      { name: "Water", quantity: 1 },
    ]);

    expect(itemAliasFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ inventoryItemId: "inv-egg", name: "eggs" }),
        expect.objectContaining({ inventoryItemId: null, name: "Water" }),
      ],
    });
  });

  it("leaves a row unlinked when two candidates both score above the fuzzy match threshold", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Tomato", unit: "pcs" },
      { id: "inv-2", name: "Tomatoes", unit: "pcs" },
    ]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    await importShoppingListItemsAction("list-1", [{ name: "Tomatoe", quantity: 1 }]);

    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [{ shoppingListId: "list-1", inventoryItemId: null, name: "Tomatoe", quantity: 1, unit: "pcs" }],
    });
  });

  it("defaults a linked row's estimatedPrice from the matched item's lastKnownPrice (AUTO-4)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-1", name: "Milk", unit: "l", lastKnownPrice: 19.9 }]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    await importShoppingListItemsAction("list-1", [{ name: "Milk", quantity: 1 }]);

    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ inventoryItemId: "inv-1", estimatedPrice: 19.9 })],
    });
  });
});

describe("smartAddShoppingListItemsAction", () => {
  function mockCreates() {
    let n = 0;
    shoppingListItemCreateMock.mockImplementation(async () => ({ id: `row-${++n}` }));
    inventoryItemCreateMock.mockImplementation(async ({ data }: { data: { name: string } }) => ({
      id: `new-${data.name}`,
    }));
  }

  it("refuses to add to a list from another household (or one that isn't ACTIVE)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await smartAddShoppingListItemsAction("someone-elses-list", [{ name: "Milk", quantity: 1 }]);

    expect(result.error).toBe("This list can't be edited right now");
    expect(shoppingListFindFirstMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-list", householdId: "household-1", status: "ACTIVE" },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects an empty batch without touching the database", async () => {
    const result = await smartAddShoppingListItemsAction("list-1", []);

    expect(result.error).toBeTruthy();
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
  });

  it("links an exact match, converges a size variant (not the look-alike Mjöl), and creates the rest with a guessed category", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-flour", name: "Mjöl", unit: "kg", category: "Pantry" },
      { id: "inv-milk", name: "Mjölk 3%", unit: "l", category: "Dairy" },
      { id: "inv-bread", name: "Bröd", unit: "pcs", category: "Bakery" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    mockCreates();

    const result = await smartAddShoppingListItemsAction("list-1", [
      { name: "bröd", quantity: 1 },
      { name: "mjölk", quantity: 2, unit: "l" },
      { name: "Apples", quantity: 6 },
    ]);

    expect(inventoryItemCreateMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "Apples",
        category: "Produce",
        unit: "pcs",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
    expect(shoppingListItemCreateMock.mock.calls.map(([arg]) => arg.data)).toEqual([
      { shoppingListId: "list-1", inventoryItemId: "inv-bread", name: "bröd", quantity: 1, unit: "pcs" },
      { shoppingListId: "list-1", inventoryItemId: "inv-milk", name: "mjölk", quantity: 2, unit: "l" },
      { shoppingListId: "list-1", inventoryItemId: "new-Apples", name: "Apples", quantity: 6, unit: "pcs" },
    ]);
    expect(result).toEqual({ addedIds: ["row-1", "row-2", "row-3"], alreadyOnList: [] });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/list-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("uses the linked item's unit when none was typed", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-milk", name: "Milk", unit: "l", category: "Dairy" }]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    mockCreates();

    await smartAddShoppingListItemsAction("list-1", [{ name: "milk", quantity: 1 }]);

    expect(shoppingListItemCreateMock.mock.calls[0][0].data.unit).toBe("l");
    expect(revalidatePathMock).not.toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("defaults a linked row's estimatedPrice from the matched item's lastKnownPrice, but not a brand-new item's (AUTO-4)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-milk", name: "Milk", unit: "l", category: "Dairy", lastKnownPrice: 21 },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    mockCreates();

    await smartAddShoppingListItemsAction("list-1", [
      { name: "milk", quantity: 1 },
      { name: "Kiwi", quantity: 2 },
    ]);

    expect(shoppingListItemCreateMock.mock.calls[0][0].data.estimatedPrice).toBe(21);
    expect(shoppingListItemCreateMock.mock.calls[1][0].data.estimatedPrice).toBeUndefined();
  });

  it("skips items already pending on the list (and repeats within the batch), reporting them instead", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-milk", name: "Milk", unit: "l", category: "Dairy" },
      { id: "inv-eggs", name: "Eggs", unit: "pcs", category: "Dairy" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([{ inventoryItemId: "inv-milk" }]);
    mockCreates();

    const result = await smartAddShoppingListItemsAction("list-1", [
      { name: "milk", quantity: 1 },
      { name: "eggs", quantity: 6 },
      { name: "Eggs", quantity: 12 },
      { name: "Kiwi", quantity: 1 },
      { name: "kiwi", quantity: 2 },
    ]);

    expect(shoppingListItemFindManyMock).toHaveBeenCalledWith({
      where: { shoppingListId: "list-1", purchased: false, inventoryItemId: { not: null } },
      select: { inventoryItemId: true },
    });
    expect(inventoryItemCreateMock).toHaveBeenCalledTimes(1);
    expect(shoppingListItemCreateMock.mock.calls.map(([arg]) => arg.data.name)).toEqual(["eggs", "Kiwi"]);
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({ addedIds: ["row-1", "row-2"], alreadyOnList: ["Milk", "Eggs", "Kiwi"] });
  });

  it("doesn't write or revalidate anything when every row is already on the list", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-milk", name: "Milk", unit: "l", category: "Dairy" }]);
    shoppingListItemFindManyMock.mockResolvedValue([{ inventoryItemId: "inv-milk" }]);

    const result = await smartAddShoppingListItemsAction("list-1", [{ name: "Milk", quantity: 1 }]);

    expect(transactionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(result).toEqual({ addedIds: [], alreadyOnList: ["Milk"] });
  });

  it("links a picked suggestion by id, but ignores an id from outside the household", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([{ id: "inv-oat", name: "Havremjölk", unit: "l", category: "Dairy" }]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    mockCreates();

    await smartAddShoppingListItemsAction("list-1", [
      { name: "Havremjölk", quantity: 1, unit: "l", inventoryItemId: "inv-oat" },
      { name: "Stolen", quantity: 1, inventoryItemId: "other-households-item" },
    ]);

    expect(shoppingListItemCreateMock.mock.calls.map(([arg]) => arg.data.inventoryItemId)).toEqual([
      "inv-oat",
      "new-Stolen",
    ]);
  });

  it("creates a new item rather than guessing when two existing items are equally plausible", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Tomato", unit: "pcs", category: "Produce" },
      { id: "inv-2", name: "Tomatoes", unit: "pcs", category: "Produce" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    mockCreates();

    await smartAddShoppingListItemsAction("list-1", [{ name: "Tomatoe", quantity: 1 }]);

    expect(shoppingListItemCreateMock.mock.calls[0][0].data.inventoryItemId).toBe("new-Tomatoe");
  });
});

describe("linkShoppingListItemAction", () => {
  it("returns 'Item not found' when the shopping-list item isn't in the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await linkShoppingListItemAction("someone-elses-item", "inv-1");

    expect(result.error).toBe("Item not found");
  });

  it("returns 'Inventory item not found' when the target inventory item isn't in the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);

    const result = await linkShoppingListItemAction("item-1", "someone-elses-inventory-item");

    expect(result.error).toBe("Inventory item not found");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("links the item when both belong to the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "Milk" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await linkShoppingListItemAction("item-1", "inv-1");

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { inventoryItemId: "inv-1" },
    });
  });
});

describe("linkShoppingListItemAction alias learning (MATCH-5)", () => {
  it("teaches an alias when an unlinked row is linked to a differently named item", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      name: "Eggs",
      inventoryItemId: null,
    });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-egg", name: "Egg" });

    const result = await linkShoppingListItemAction("item-1", "inv-egg");

    expect(result).toEqual({});
    expect(inventoryItemFindFirstMock).toHaveBeenCalledWith({ where: { id: "inv-egg", householdId: "household-1" } });
    expect(itemAliasUpsertMock).toHaveBeenCalledWith({
      where: { householdId_normalizedName: { householdId: "household-1", normalizedName: "eggs" } },
      create: { householdId: "household-1", normalizedName: "eggs", inventoryItemId: "inv-egg" },
      update: { inventoryItemId: "inv-egg" },
    });
  });

  it("learns nothing when the names already match, or when the row was linked before", async () => {
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-egg", name: "Egg" });
    shoppingListItemFindFirstMock.mockResolvedValueOnce({
      id: "item-1",
      shoppingListId: "list-1",
      name: "egg.",
      inventoryItemId: null,
    });
    await linkShoppingListItemAction("item-1", "inv-egg");
    shoppingListItemFindFirstMock.mockResolvedValueOnce({
      id: "item-2",
      shoppingListId: "list-1",
      name: "Eggs",
      inventoryItemId: "inv-other",
    });
    await linkShoppingListItemAction("item-2", "inv-egg");

    expect(shoppingListItemUpdateMock).toHaveBeenCalledTimes(2);
    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
  });

  it("learns nothing for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({
      id: "item-1",
      shoppingListId: "list-1",
      name: "Eggs",
      inventoryItemId: null,
    });
    inventoryItemFindFirstMock.mockResolvedValue(null);

    const result = await linkShoppingListItemAction("item-1", "someone-elses-egg");

    expect(result.error).toBe("Inventory item not found");
    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
  });
});

describe("createInventoryItemFromShoppingListItemAction", () => {
  it("returns 'Item not found' for a shopping-list item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await createInventoryItemFromShoppingListItemAction("someone-elses-item", "Produce");

    expect(result.error).toBe("Item not found");
    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a category over 60 characters", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", shoppingListId: "list-1" });

    const result = await createInventoryItemFromShoppingListItemAction("item-1", "x".repeat(61));

    expect(result.error).toBe("Category must be 60 characters or fewer");
  });

  it("guesses a blank category from the item's name (AUTO-2)", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", shoppingListId: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    await createInventoryItemFromShoppingListItemAction("item-1", "   ");

    expect(inventoryItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Dairy & eggs" }) }),
    );
  });

  it("falls back to 'Uncategorized' for a blank category it can't guess", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", name: "AA batteries", shoppingListId: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    await createInventoryItemFromShoppingListItemAction("item-1", "   ");

    expect(inventoryItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Uncategorized" }) }),
    );
  });
});

describe("updateShoppingListItemAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await updateShoppingListItemAction("someone-elses-item", {
      name: "Milk",
      quantity: 1,
      unit: "l",
    });

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });

    const result = await updateShoppingListItemAction("item-1", { name: "Milk", quantity: 0, unit: "l" });

    expect(result.error).toBe("Quantity must be greater than 0");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a blank name", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });

    const result = await updateShoppingListItemAction("item-1", { name: "   ", quantity: 1, unit: "l" });

    expect(result.error).toBe("Name is required");
  });

  it("updates name/quantity/unit, falling back to 'pcs' for a blank unit", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await updateShoppingListItemAction("item-1", { name: "Oat milk", quantity: 2, unit: "" });

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { name: "Oat milk", quantity: 2, unit: "pcs" },
    });
  });

  it("scopes the item lookup to the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    await updateShoppingListItemAction("item-1", { name: "Milk", quantity: 1, unit: "l", note: "Ripe ones" });

    expect(shoppingListItemFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "item-1", shoppingList: { householdId: "household-1" } },
      }),
    );
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("saves a trimmed note (GAP-5)", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await updateShoppingListItemAction("item-1", {
      name: "Avocado",
      quantity: 3,
      unit: "pcs",
      note: "  get the ripe ones  ",
    });

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { name: "Avocado", quantity: 3, unit: "pcs", note: "get the ripe ones" },
    });
  });

  it("clears a blank or whitespace-only note to null rather than storing ''", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    await updateShoppingListItemAction("item-1", { name: "Avocado", quantity: 3, unit: "pcs", note: "   " });

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { name: "Avocado", quantity: 3, unit: "pcs", note: null },
    });
  });

  it("leaves an existing note untouched when the caller doesn't send one", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    await updateShoppingListItemAction("item-1", { name: "Avocado", quantity: 3, unit: "pcs" });

    const { data } = shoppingListItemUpdateMock.mock.calls[0][0];
    expect(data).not.toHaveProperty("note");
  });

  it("rejects a note over 200 characters", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });

    const result = await updateShoppingListItemAction("item-1", {
      name: "Avocado",
      quantity: 3,
      unit: "pcs",
      note: "x".repeat(201),
    });

    expect(result.error).toBe("Note must be 200 characters or fewer");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateShoppingListItemPriceAction (AUTO-4 inline price correction)", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await updateShoppingListItemPriceAction("someone-elses-item", 10);

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a negative price", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });

    const result = await updateShoppingListItemPriceAction("item-1", -5);

    expect(result.error).toBe("Price can't be negative");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("saves the corrected price, which is the user's own and never overwritten by a create-path default again", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await updateShoppingListItemPriceAction("item-1", 27.5);

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { estimatedPrice: 27.5 },
    });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

});

describe("unlinkShoppingListItemAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await unlinkShoppingListItemAction("someone-elses-item");

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("clears the item's inventory link", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await unlinkShoppingListItemAction("item-1");

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { inventoryItemId: null },
    });
  });
});

describe("setShoppingListItemCategoryAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await setShoppingListItemCategoryAction("someone-elses-item", "Dairy");

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "someone-elses-item", shoppingList: { householdId: "household-1" } },
      }),
    );
    expect(inventoryItemUpdateManyMock).not.toHaveBeenCalled();
  });

  it("refuses an unlinked row, which has no category to change yet", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ shoppingListId: "list-1", inventoryItemId: null });

    const result = await setShoppingListItemCategoryAction("item-1", "Dairy");

    expect(result.error).toBeDefined();
    expect(inventoryItemUpdateManyMock).not.toHaveBeenCalled();
  });

  it("re-files the linked inventory item, scoped to the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ shoppingListId: "list-1", inventoryItemId: "inv-1" });
    inventoryItemUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await setShoppingListItemCategoryAction("item-1", "  Dairy  ");

    expect(result).toEqual({});
    expect(inventoryItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "inv-1", householdId: "household-1" },
      data: { category: "Dairy", updatedByUserId: "user-1" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/list-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("clears a blank category back to the locale's Uncategorized bucket", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ shoppingListId: "list-1", inventoryItemId: "inv-1" });
    inventoryItemUpdateManyMock.mockResolvedValue({ count: 1 });

    await setShoppingListItemCategoryAction("item-1", "   ");

    expect(inventoryItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Uncategorized" }) }),
    );
  });

  it("rejects a category over 60 characters", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ shoppingListId: "list-1", inventoryItemId: "inv-1" });

    const result = await setShoppingListItemCategoryAction("item-1", "x".repeat(61));

    expect(result.error).toBe("Category must be 60 characters or fewer");
    expect(inventoryItemUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("resolveShoppingListMappingsAction", () => {
  it("returns resolvedCount 0 without querying anything for an empty batch", async () => {
    const result = await resolveShoppingListMappingsAction([]);

    expect(result).toEqual({ resolvedCount: 0 });
    expect(shoppingListItemFindManyMock).not.toHaveBeenCalled();
  });

  it("links an 'existing' resolution and creates+links a 'new' one in the same batch", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-1", shoppingListId: "list-1", name: "Milk", inventoryItemId: null },
      { id: "item-2", shoppingListId: "list-1", name: "Eggs", inventoryItemId: null },
    ]);
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "Milk" });
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await resolveShoppingListMappingsAction([
      { itemId: "item-1", kind: "existing", inventoryItemId: "inv-1" },
      { itemId: "item-2", kind: "new", category: "Dairy" },
    ]);

    expect(result).toEqual({ resolvedCount: 2 });
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { inventoryItemId: "inv-1" },
    });
    expect(inventoryItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Eggs", category: "Dairy" }) }),
    );
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-2" },
      data: { inventoryItemId: "inv-new" },
    });
  });

  it("teaches an alias for an 'existing' link whose name differs, never for a 'new' one (MATCH-5)", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-1", shoppingListId: "list-1", name: "Mjölk", inventoryItemId: null },
      { id: "item-2", shoppingListId: "list-1", name: "Eggs", inventoryItemId: null },
    ]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new", name: "Eggs" });

    await resolveShoppingListMappingsAction([
      { itemId: "item-1", kind: "existing", inventoryItemId: "inv-1" },
      { itemId: "item-2", kind: "new", category: "Dairy" },
    ]);

    expect(itemAliasUpsertMock).toHaveBeenCalledTimes(1);
    expect(itemAliasUpsertMock).toHaveBeenCalledWith({
      where: { householdId_normalizedName: { householdId: "household-1", normalizedName: "mjölk" } },
      create: { householdId: "household-1", normalizedName: "mjölk", inventoryItemId: "inv-1" },
      update: { inventoryItemId: "inv-1" },
    });
  });

  it("teaches no alias for a foreign item id", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-1", shoppingListId: "list-1", name: "Mjölk", inventoryItemId: null },
    ]);
    inventoryItemFindFirstMock.mockResolvedValue(null);

    await resolveShoppingListMappingsAction([
      { itemId: "item-1", kind: "existing", inventoryItemId: "someone-elses-inventory-item" },
    ]);

    expect(inventoryItemFindFirstMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-inventory-item", householdId: "household-1" },
    });
    expect(itemAliasUpsertMock).not.toHaveBeenCalled();
  });

  it("skips a resolution naming an inventory item outside the caller's household", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-1", shoppingListId: "list-1", name: "Milk", inventoryItemId: null },
    ]);
    inventoryItemFindFirstMock.mockResolvedValue(null);

    const result = await resolveShoppingListMappingsAction([
      { itemId: "item-1", kind: "existing", inventoryItemId: "someone-elses-inventory-item" },
    ]);

    expect(result).toEqual({ resolvedCount: 0 });
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalled();
  });

  it("resolves a batch of rows in parallel, still reporting the right resolvedCount and revalidating the list (SCALE-C)", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-1", shoppingListId: "list-1", name: "Milk", inventoryItemId: null },
      { id: "item-2", shoppingListId: "list-1", name: "Eggs", inventoryItemId: null },
      { id: "item-3", shoppingListId: "list-1", name: "Bread", inventoryItemId: null },
    ]);
    // item-1 resolves against a real inventory item; item-2's named
    // inventory item doesn't exist (attempted but not resolved); item-3 is
    // a "new" resolution.
    inventoryItemFindFirstMock.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "inv-1" ? { id: "inv-1", name: "Milk" } : null,
    );
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await resolveShoppingListMappingsAction([
      { itemId: "item-1", kind: "existing", inventoryItemId: "inv-1" },
      { itemId: "item-2", kind: "existing", inventoryItemId: "missing-inv" },
      { itemId: "item-3", kind: "new", category: "Bakery" },
    ]);

    // Only item-1 and item-3 actually resolved; item-2's target didn't
    // exist, so it's skipped — same as the sequential loop this replaced.
    expect(result).toEqual({ resolvedCount: 2 });
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { inventoryItemId: "inv-1" },
    });
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-3" },
      data: { inventoryItemId: "inv-new" },
    });
    expect(shoppingListItemUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "item-2" } }),
    );
    // Revalidation still fires for the list even though one resolution in
    // the batch failed, mirroring the old loop's shoppingListId side effect.
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/list-1");
  });

  it("skips a resolution for an item outside the caller's household or already linked", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-2", shoppingListId: "list-1", name: "Eggs", inventoryItemId: "inv-already" },
    ]);

    const result = await resolveShoppingListMappingsAction([
      { itemId: "someone-elses-item", kind: "new", category: "" },
      { itemId: "item-2", kind: "new", category: "" },
    ]);

    expect(result).toEqual({ resolvedCount: 0 });
    expect(inventoryItemCreateMock).not.toHaveBeenCalled();
  });

  it("guesses the category of a 'new' resolution left blank (AUTO-2)", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      { id: "item-2", shoppingListId: "list-1", name: "Ägg", inventoryItemId: null },
    ]);
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await resolveShoppingListMappingsAction([{ itemId: "item-2", kind: "new", category: " " }]);

    expect(result).toEqual({ resolvedCount: 1 });
    expect(inventoryItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Ägg", category: "Dairy & eggs" }) }),
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
      // AUTO-4: this purchase's price also becomes the item's lastKnownPrice.
      data: { quantity: 5, lastKnownPrice: 25 },
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

describe("undoAutoAddedItemsAction (AUTO-8)", () => {
  it("deletes only this household's still-pending, auto-added rows among the given ids (IDOR guard)", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([{ shoppingListId: "default" }]);
    shoppingListItemDeleteManyMock.mockResolvedValue({ count: 1 });

    const result = await undoAutoAddedItemsAction(["row-1", "someone-elses-row"]);

    const where = {
      id: { in: ["row-1", "someone-elses-row"] },
      addedAutomatically: true,
      purchased: false,
      shoppingList: { householdId: "household-1" },
    };
    expect(shoppingListItemDeleteManyMock).toHaveBeenCalledWith({ where });
    expect(result).toEqual({ removed: 1 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/default");
  });

  it("is idempotent — a second Undo on already-removed rows is a quiet no-op", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([]);
    shoppingListItemDeleteManyMock.mockResolvedValue({ count: 0 });

    const result = await undoAutoAddedItemsAction(["row-1"]);

    expect(result).toEqual({ removed: 0 });
    expect(result.error).toBeUndefined();
  });

  it("rejects an empty id list without touching the database", async () => {
    const result = await undoAutoAddedItemsAction([]);

    expect(result.error).toBeDefined();
    expect(shoppingListItemDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("applyReceiptScanAction", () => {
  const baseList = {
    id: "list-1",
    items: [
      { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } },
      { id: "sli-2", purchased: true, quantity: 1, unit: "pcs", inventoryItem: { id: "inv-2", quantity: 5 } },
    ],
  };

  it("refuses when the list isn't active/owned by the caller's household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await applyReceiptScanAction("someone-elses-list", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
    ]);

    expect(result.error).toBe("This list can't be edited right now");
  });

  it("drops matches for an unknown item id, an already-purchased item, and a non-positive price", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "does-not-exist", price: 10 },
      { shoppingListItemId: "sli-2", price: 10 }, // already purchased
      { shoppingListItemId: "sli-1", price: 0 }, // non-positive
    ]);

    expect(result.error).toBe("Nothing to apply");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("de-dupes a shopping-list item matched twice, applying only the first", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-1", price: 999 },
    ]);

    expect(result.itemsUpdated).toBe(1);
    expect(result.totalAmount).toBe(10);
  });

  it("sums totalAmount correctly across several matches applied in parallel (SCALE-C)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } },
        { id: "sli-2", purchased: false, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
        { id: "sli-3", purchased: false, quantity: 3, unit: "pcs", inventoryItem: null },
      ],
    });

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 25 },
      { shoppingListItemId: "sli-3", price: 7.5 },
    ]);

    expect(result.itemsUpdated).toBe(3);
    expect(result.totalAmount).toBe(42.5);
    // AUTO-4: a scanned receipt price also becomes the item's lastKnownPrice.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 3, lastKnownPrice: 10 },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-2" },
      data: { quantity: 6, lastKnownPrice: 25 },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: null },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-2", price: 25, quantity: 1, unit: "kg", store: null },
    });
    // GAP-9: every row written, as one batch, after the transaction — the
    // unlinked sli-3 wrote no PriceHistory and so isn't in it.
    expect(recordPriceSpikesMock).toHaveBeenCalledTimes(1);
    const [householdId, recorded, actingUserId] = recordPriceSpikesMock.mock.calls[0] as unknown as [
      string,
      { inventoryItemId: string }[],
      string,
    ];
    expect(householdId).toBe("household-1");
    expect(actingUserId).toBe("user-1");
    expect(recorded).toHaveLength(2);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs" },
        { priceHistoryId: "ph-inv-2", inventoryItemId: "inv-2", price: 25, quantity: 1, unit: "kg" },
      ]),
    );
  });

  it("doesn't check for price spikes when the transaction fails", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);
    transactionMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]),
    ).rejects.toThrow("boom");
    expect(recordPriceSpikesMock).not.toHaveBeenCalled();
  });

  it("stamps every PriceHistory row it writes with the receipt's store (GAP-6)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    await applyReceiptScanAction(
      "list-1",
      "SEK",
      [{ shoppingListItemId: "sli-1", price: 10 }],
      "  ICA Maxi  ",
    );

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: "ICA Maxi" },
    });
  });

  it("treats a blank/whitespace-only store the same as no store (GAP-6)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }], "   ");

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: null },
    });
  });

  it("converts a foreign-currency price using the fetched exchange rate", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);
    fetchExchangeRateMock.mockResolvedValue(0.5);

    const result = await applyReceiptScanAction("list-1", "EUR", [
      { shoppingListItemId: "sli-1", price: 20 },
    ]);

    expect(fetchExchangeRateMock).toHaveBeenCalledWith("EUR", "SEK");
    expect(result.totalAmount).toBe(10);
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 3, lastKnownPrice: 10 }, // 1 + quantity(2), converted price
    });
  });

  it("returns an error when the exchange rate can't be fetched, applying nothing", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);
    fetchExchangeRateMock.mockResolvedValue(null);

    const result = await applyReceiptScanAction("list-1", "EUR", [
      { shoppingListItemId: "sli-1", price: 20 },
    ]);

    expect(result.error).toContain("exchange rate");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // AUTO-7
  it("estimates an expiry for a matched line that crosses 0→>0 in a category with a known shelf life", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        {
          id: "sli-1",
          purchased: false,
          quantity: 1,
          inventoryItem: {
            id: "inv-1",
            quantity: 0,
            category: "Meat & fish",
            expiresAt: null,
            expiresAtEstimated: false,
            shelfLifeDays: null,
          },
        },
      ],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });
});

describe("deleteShoppingListItemAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await deleteShoppingListItemAction("someone-elses-item");

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes an already-purchased item directly, without checking for a LIST_CLEARED transition", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1", purchased: true });

    const result = await deleteShoppingListItemAction("item-1");

    expect(result).toEqual({});
    expect(shoppingListItemDeleteMock).toHaveBeenCalledWith({ where: { id: "item-1" } });
    expect(shoppingListItemCountMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("fires LIST_CLEARED when deleting the last pending item", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1", purchased: false });
    shoppingListItemCountMock.mockResolvedValueOnce(0);

    const result = await deleteShoppingListItemAction("item-1");

    expect(result).toEqual({});
    expect(shoppingListItemDeleteMock).toHaveBeenCalledWith({ where: { id: "item-1" } });
    expect(shoppingListItemCountMock).toHaveBeenCalledWith({
      where: { shoppingListId: "list-1", purchased: false },
    });
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "LIST_CLEARED", shoppingListId: "list-1" },
    });
  });

  it("does not fire LIST_CLEARED when deleting a pending item while others remain", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1", purchased: false });
    shoppingListItemCountMock.mockResolvedValueOnce(1);

    await deleteShoppingListItemAction("item-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
  });
});

describe("registerReceiptAction", () => {
  it("rejects an empty items array", async () => {
    const result = await registerReceiptAction("My receipt", "SEK", []);

    expect(result.error).toBeTruthy();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // SEC-7: nothing below the 6 MB action body limit caps a receipt, so the
  // schema has to — one over the cap is rejected before any write.
  it("rejects more than 300 receipt lines", async () => {
    const items = Array.from({ length: 301 }, (_, i) => ({
      name: `Item ${i}`,
      quantity: 1,
      unit: "pcs",
      price: 10,
    }));

    const result = await registerReceiptAction("My receipt", "SEK", items);

    expect(result.error).toBe("Too many items");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a line whose quantity or price is absurdly large", async () => {
    const tooMuchQuantity = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 100_001, unit: "l", price: 15 },
    ]);
    const tooHighPrice = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 1, unit: "l", price: 1_000_001 },
    ]);

    expect(tooMuchQuantity.error).toBeTruthy();
    expect(tooHighPrice.error).toBe("Price is too large");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a completed list with items auto-linked by exact name match, updates inventory and logs a Groceries expense", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
    transactionCreateMock.mockResolvedValue({});

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 2, unit: "l", price: 15 },
    ]);

    expect(shoppingListCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        name: "My receipt",
        status: "COMPLETED",
      }),
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        inventoryItemId: "inv-1",
        name: "Milk",
        quantity: 2,
        unit: "l",
        purchased: true,
        estimatedPrice: 15,
        // Registered after the shop: already home, counted below, and its
        // price recorded — nothing left for the put-away step.
        putAwayAt: expect.any(Date),
        priceRecordedAt: expect.any(Date),
      },
    });
    // AUTO-4: a registered receipt's price also becomes the item's
    // lastKnownPrice.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 4, lastKnownPrice: 15 },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l", store: null },
    });
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      [{ priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l" }],
      "user-1",
    );
    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: "cat-groceries", amount: 15, type: "EXPENSE" }),
      }),
    );
    expect(result.unresolvedNotice).toBeUndefined();
    expect(result).toEqual(
      expect.objectContaining({ listId: "list-1", itemsAdded: 1, totalAmount: 15 }),
    );
  });

  it("logs the expense inside the receipt's transaction and returns a friendly error when it can't be written (MAINT-5)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    transactionCreateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 2, unit: "l", price: 15 },
    ]);

    // One transaction for stock and expense alike, so the failed insert
    // rolls the stock back too: retrying can't count the milk twice.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(resolveShoppingExpenseCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: expect.anything() }),
      "household-1",
    );
    expect(result).toEqual({ error: expect.any(String) });
    expect(recordPriceSpikesMock).not.toHaveBeenCalled();
  });

  // AUTO-7
  it("estimates an expiry for a matched line that crosses 0→>0 in a category with a known shelf life", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({
      id: "inv-1",
      quantity: 0,
      unit: "l",
      category: "Dairy & eggs",
      expiresAt: null,
      expiresAtEstimated: false,
      shelfLifeDays: null,
    });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [{ name: "Milk", quantity: 2, unit: "l", price: 15 }]);

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  it("falls back to a default list name and leaves an unmatched item unlinked, reporting it via unresolvedNotice", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "Receipt — today" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction(undefined, "SEK", [
      { name: "Mystery item", quantity: 1, price: 10 },
    ]);

    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: expect.stringContaining("Receipt") }) }),
    );
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        inventoryItemId: null,
        name: "Mystery item",
        quantity: 1,
        unit: "pcs",
        purchased: true,
        estimatedPrice: 10,
        // Unlinked: put away (nothing to count), but no PriceHistory row.
        putAwayAt: expect.any(Date),
      },
    });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(result.unresolvedNotice).toBe("1 item wasn't linked");
  });

  // PERF-16
  it("loads the household's inventory once for a receipt with several unmatched lines, and still fuzzy-matches in memory", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Whole milk", category: "Dairy & eggs", quantity: 1, unit: "l" },
    ]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Whole milk 1l", quantity: 1, unit: "l", price: 15 },
      { name: "Zzzq", quantity: 1, price: 10 },
      { name: "Xxyw", quantity: 1, price: 10 },
      { name: "Qqvv", quantity: 1, price: 10 },
    ]);

    expect(inventoryItemFindManyMock.mock.calls.filter(([args]) => args?.where?.householdId === "household-1"))
      .toHaveLength(1);
    expect(result.unresolvedNotice).toBe("3 items weren't linked");
  });

  // PERF-16: the lazy read runs after line 1 already created its item, so
  // the read returns that row; it must not be counted twice or the single
  // confident fuzzy match looks like a tie and the line is left unlinked.
  it("still links a later line to an item an earlier line of the same receipt created, with one inventory read", async () => {
    const created = { id: "inv-new", name: "Whole milk", category: "Dairy & eggs", quantity: 0, unit: "pcs" };
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue(created);
    inventoryItemFindManyMock.mockResolvedValue([created]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Whole milk", quantity: 1, price: 15, newItemCategory: "Dairy & eggs" },
      { name: "Whole milk 1l", quantity: 1, price: 15 },
    ]);

    expect(inventoryItemFindManyMock.mock.calls.filter(([args]) => args?.where?.householdId === "household-1"))
      .toHaveLength(1);
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("sums quantity across two lines matching the same inventory item instead of overwriting each other", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 10, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [
      { name: "Apple", quantity: 2, price: 5 },
      { name: "Apple", quantity: 3, price: 6 },
    ]);

    expect(inventoryItemUpdateMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      // AUTO-4: the later of the two lines' prices wins as lastKnownPrice.
      data: { quantity: 15, lastKnownPrice: 6 }, // 10 + 2 + 3
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledTimes(2);
    // GAP-9: both lines go to recordPriceSpikes in one call, which pools
    // them into one decision for the item.
    expect(recordPriceSpikesMock).toHaveBeenCalledTimes(1);
    expect(recordPriceSpikesMock.mock.calls[0]).toEqual([
      "household-1",
      [
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 5, quantity: 2, unit: "pcs" },
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 6, quantity: 3, unit: "pcs" },
      ],
      "user-1",
    ]);
  });

  it("stamps every PriceHistory row it writes with the receipt's store, trimmed (GAP-6)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction(
      "My receipt",
      "SEK",
      [{ name: "Milk", quantity: 2, unit: "l", price: 15 }],
      "  ICA Maxi  ",
    );

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l", store: "ICA Maxi" },
    });
  });

  it("links to the inventory item the user explicitly matched in review, skipping exact/fuzzy auto-match", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-2", quantity: 1, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "ORG BANANAS 2LB", quantity: 1, price: 12, inventoryItemId: "inv-2" },
    ]);

    expect(inventoryItemFindFirstMock).toHaveBeenCalledWith({
      where: { id: "inv-2", householdId: "household-1" },
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ inventoryItemId: "inv-2", name: "ORG BANANAS 2LB" }),
    });
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("creates a new inventory item in the chosen category when the user explicitly chose 'create new'", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new", quantity: 0, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Kombucha", quantity: 1, unit: "btl", price: 30, newItemCategory: "Beverages" },
    ]);

    expect(inventoryItemFindFirstMock).not.toHaveBeenCalled();
    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        name: "Kombucha",
        category: "Beverages",
        unit: "btl",
        quantity: 0,
      }),
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ inventoryItemId: "inv-new", name: "Kombucha" }),
    });
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("guesses the category for a 'create new' line whose category was left blank (AUTO-2)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new", quantity: 0, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [
      { name: "Apelsinjuice", quantity: 1, price: 30, newItemCategory: "" },
    ]);

    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Apelsinjuice", category: "Drinks" }),
    });
  });

  it("converts a foreign-currency price using the fetched exchange rate", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    fetchExchangeRateMock.mockResolvedValue(0.5);

    const result = await registerReceiptAction("My receipt", "EUR", [
      { name: "Cheese", quantity: 1, price: 20 },
    ]);

    expect(fetchExchangeRateMock).toHaveBeenCalledWith("EUR", "SEK");
    expect(result.totalAmount).toBe(10);
  });

  it("returns an error and creates nothing when the exchange rate can't be fetched", async () => {
    fetchExchangeRateMock.mockResolvedValue(null);

    const result = await registerReceiptAction("My receipt", "EUR", [
      { name: "Cheese", quantity: 1, price: 20 },
    ]);

    expect(result.error).toContain("exchange rate");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction", () => {
  it("completes a list with unresolved (unlinked) items instead of refusing, and reports how many", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: null, purchased: false, estimatedPrice: null },
        { inventoryItemId: null, purchased: false, estimatedPrice: null },
        { inventoryItemId: "inv-1", purchased: true, estimatedPrice: null },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeUndefined();
    expect(shoppingListUpdateMock).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    });
    expect(result.unresolvedNotice).toBe("2 items weren't linked");
  });

  it("completes cleanly with no unresolvedNotice when every item is linked", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: null }],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("logs a single Groceries expense summing only purchased items with a price", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: "inv-1", purchased: true, estimatedPrice: 20 },
        { inventoryItemId: "inv-2", purchased: true, estimatedPrice: 15 },
        { inventoryItemId: "inv-3", purchased: false, estimatedPrice: null },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
    transactionCreateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          householdId: "household-1",
          categoryId: "cat-groceries",
          amount: 35,
          type: "EXPENSE",
          createdByUserId: "user-1",
        }),
      }),
    );
    expect(result.expenseLoggedMessage).toContain("35");
  });

  it("does not log an expense when nothing purchased had a price", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: false, estimatedPrice: null }],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(transactionCreateMock).not.toHaveBeenCalled();
    expect(result.expenseLoggedMessage).toBeUndefined();
  });

  it("completing the default list un-defaults it and starts a fresh default in the same transaction (AUTO-8)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Next shop", isDefault: true, items: [] });
    shoppingListUpdateMock.mockResolvedValue({});
    getOrCreateDefaultShoppingListMock.mockResolvedValue({ id: "list-2", name: "Next shop" });
    const txShoppingListUpdate = vi.fn();
    transactionMock.mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({ shoppingList: { update: txShoppingListUpdate } }),
    );

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeUndefined();
    expect(txShoppingListUpdate).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: expect.objectContaining({ status: "COMPLETED", isDefault: false }),
    });
    expect(getOrCreateDefaultShoppingListMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: { update: txShoppingListUpdate } }),
      "household-1",
    );
  });

  it("completing an ordinary named list doesn't create a default list", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Big trip", isDefault: false, items: [] });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(getOrCreateDefaultShoppingListMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → shopping expense (MAINT-5)", () => {
  const pricedList = {
    id: "list-1",
    name: "This week",
    items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: 20 }],
  };

  it("logs the expense inside the completion transaction, to the resolved category, and names it in the toast", async () => {
    shoppingListFindFirstMock.mockResolvedValue(pricedList);
    shoppingListUpdateMock.mockResolvedValue({});
    resolveShoppingExpenseCategoryMock.mockResolvedValueOnce({ id: "cat-food", name: "Mat" });

    const result = await completeShoppingListAction("list-1");

    expect(transactionMock).toHaveBeenCalledTimes(1);
    // Handed the transaction client, not the global prisma.
    expect(resolveShoppingExpenseCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: expect.anything() }),
      "household-1",
    );
    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-food", amount: 20 }) }),
    );
    expect(result.expenseLoggedMessage).toBe("Logged 20.00 to Mat");
  });

  it("returns a friendly error instead of throwing when the expense can't be written", async () => {
    shoppingListFindFirstMock.mockResolvedValue(pricedList);
    shoppingListUpdateMock.mockResolvedValue({});
    transactionCreateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeTruthy();
    expect(result.transactionId).toBeUndefined();
    // Nothing learned from a completion that rolled back.
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → transactionId", () => {
  it("returns the id of the Groceries expense it logged, so Undo can target exactly that row", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: 20 }],
    });
    shoppingListUpdateMock.mockResolvedValue({});
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
    transactionCreateMock.mockResolvedValue({ id: "txn-1" });

    const result = await completeShoppingListAction("list-1");

    expect(result.transactionId).toBe("txn-1");
  });

  it("returns no transactionId when nothing had a price (no expense logged)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: null }],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(result.transactionId).toBeUndefined();
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });
});

describe("uncompleteShoppingListAction", () => {
  it("returns 'List not found' for a list outside the caller's household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await uncompleteShoppingListAction("someone-elses-list", "txn-1");

    expect(result.error).toBe("List not found");
    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses-list", householdId: "household-1" } }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("restores ACTIVE and deletes exactly the completion's expense, household-scoped", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "COMPLETED" });

    const result = await uncompleteShoppingListAction("list-1", "txn-1");

    expect(result).toEqual({});
    expect(shoppingListUpdateMock).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: { status: "ACTIVE", completedAt: null },
    });
    expect(transactionDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "txn-1", householdId: "household-1" },
    });
  });

  it("skips the expense delete when the completion logged none", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "COMPLETED" });

    await uncompleteShoppingListAction("list-1");

    expect(shoppingListUpdateMock).toHaveBeenCalled();
    expect(transactionDeleteManyMock).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op on a list that's no longer COMPLETED (double-tapped Undo)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "ACTIVE" });

    const result = await uncompleteShoppingListAction("list-1", "txn-1");

    expect(result).toEqual({});
    expect(transactionMock).not.toHaveBeenCalled();
    expect(transactionDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → store-order learning (AUTO-9)", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 10, minute));

  it("folds the hand-ticked sequence into the learned order, keyed by category", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { ...household, categoryOrderLearned: { "auto:produce": 0.05 } },
      userId: "user-1",
    });
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        // Frozen ticked first, produce last: the reverse of the default.
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(9), inventoryItem: { category: "Produce" } },
        // Receipt-applied (no timestamp) and unlinked "Other" rows teach nothing.
        { inventoryItemId: "c", purchased: true, estimatedPrice: null, checkedOffAt: null, inventoryItem: { category: "Bakery" } },
        { inventoryItemId: null, purchased: true, estimatedPrice: null, checkedOffAt: at(5), inventoryItem: null },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(householdUpdateMock).toHaveBeenCalledTimes(1);
    const { where, data } = householdUpdateMock.mock.calls[0][0];
    expect(where).toEqual({ id: "household-1" });
    expect(Object.keys(data.categoryOrderLearned).sort()).toEqual(["auto:frozen", "auto:produce"]);
    // Produce was observed at the far end (0.75), so it moves up from 0.05.
    expect(data.categoryOrderLearned["auto:produce"]).toBeCloseTo(0.05 + 0.3 * (0.75 - 0.05), 4);
  });

  it("writes nothing when the trip touched fewer than two categories", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(2), inventoryItem: { category: "Frozen" } },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("still completes the list when saving what it learned fails", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(2), inventoryItem: { category: "Produce" } },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});
    householdUpdateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeUndefined();
  });
});

describe("saveCategoryOrderAction / resetCategoryOrderAction (AUTO-9)", () => {
  it("rejects an empty or malformed order without writing", async () => {
    expect((await saveCategoryOrderAction([])).error).toBe("Invalid section order");
    expect((await saveCategoryOrderAction(["ok", "x".repeat(201)])).error).toBe("Invalid section order");
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("merges one list's reordered sections into the household's whole order", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { ...household, categoryOrderLearned: null, categoryOrderManual: [] },
      userId: "user-1",
    });

    const result = await saveCategoryOrderAction(["auto:frozen", "auto:produce"]);

    expect(result.error).toBeUndefined();
    const manual: string[] = householdUpdateMock.mock.calls[0][0].data.categoryOrderManual;
    expect(householdUpdateMock.mock.calls[0][0].where).toEqual({ id: "household-1" });
    // Frozen takes produce's old first slot; everything else keeps its place.
    expect(manual[0]).toBe("auto:frozen");
    expect(manual.indexOf("auto:produce")).toBeGreaterThan(manual.indexOf("auto:dairy"));
    expect(manual.indexOf("auto:bakery")).toBe(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/[id]", "page");
  });

  it("reset empties the manual order and hands back the old one for Undo", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { ...household, categoryOrderManual: ["garage", "auto:produce"] },
      userId: "user-1",
    });

    const result = await resetCategoryOrderAction();

    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { categoryOrderManual: [] },
    });
    expect(result.previous).toEqual(["garage", "auto:produce"]);
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
      expect.objectContaining({ quantity: 3, lastKnownPrice: 18, expiresAtEstimated: true, expiresAt: expect.any(Date) }),
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

describe("applyReceiptScanAction — put-away mode (ON_PUT_AWAY)", () => {
  function asPutAwayHousehold() {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", inventorySyncMode: "ON_PUT_AWAY" },
      userId: "user-1",
    });
  }

  it("prices and ticks the rows but leaves the stock for the put-away step", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, putAwayAt: null, priceRecordedAt: null, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } },
        // Ticked in the store, scanned at home — the usual order.
        { id: "sli-2", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
      ],
    });

    const result = await applyReceiptScanAction(
      "list-1",
      "SEK",
      [
        { shoppingListItemId: "sli-1", price: 10 },
        { shoppingListItemId: "sli-2", price: 30 },
      ],
      "ICA",
    );

    expect(result.itemsUpdated).toBe(2);
    // Claimed only while still waiting for a price; an unticked row's
    // reminder goes to whoever applied the receipt.
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "sli-1",
        shoppingListId: "list-1",
        OR: [{ purchased: false }, { putAwayAt: null, priceRecordedAt: null }],
      },
      data: { estimatedPrice: 10, purchased: true, checkedOffByUserId: "user-1" },
    });
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estimatedPrice: 30, purchased: true } }),
    );
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      data: { priceRecordedAt: expect.any(Date) },
    });
    // Only the price moves on the inventory item — no quantity.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { lastKnownPrice: 10 } });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-2" }, data: { lastKnownPrice: 30 } });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-2", price: 30, quantity: 1, unit: "kg", store: "ICA" },
    });
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      expect.arrayContaining([expect.objectContaining({ inventoryItemId: "inv-1" })]),
      "user-1",
    );
  });

  it("puts an unlinked row away at once — no PriceHistory, so no priceRecordedAt, and nothing left to match", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "pcs", inventoryItem: null }],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({ where: { id: "sli-1" }, data: { putAwayAt: expect.any(Date) } });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("skips a line whose row a put-away or another receipt claimed first", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } }],
    });
    txShoppingListItemUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(result).toEqual({ itemsUpdated: 0, totalAmount: 0 });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("won't price a row twice or re-add one already put away", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: new Date(), quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } },
        { id: "sli-2", purchased: true, putAwayAt: new Date(), priceRecordedAt: null, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
      ],
    });

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 30 },
    ]);

    expect(result.error).toBe("Nothing to apply");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("in ON_CHECK mode a receipt line is the arrival, and the row is put away", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } }],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      data: { priceRecordedAt: expect.any(Date), putAwayAt: expect.any(Date) },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 3, lastKnownPrice: 10 },
    });
  });

  it("in ON_CHECK mode two lines for the same inventory item both land, each on the re-read stock", async () => {
    const shared = { id: "inv-1", quantity: 1 };
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: shared },
        { id: "sli-2", purchased: false, quantity: 3, unit: "pcs", inventoryItem: shared },
      ],
    });
    txShoppingListItemFindUniqueMock
      .mockResolvedValueOnce({ id: "sli-1", quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } })
      // After the first line's write inside the same transaction.
      .mockResolvedValueOnce({ id: "sli-2", quantity: 3, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 3 } });

    await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 12 },
    ]);

    expect(inventoryItemUpdateMock.mock.calls.map(([args]) => args.data.quantity)).toEqual([3, 6]);
  });
});

describe("generateFromLowStockAction — incoming stock", () => {
  it("doesn't re-list an item whose shortfall is already in the cart", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 0, lowStockThreshold: 2, unit: "l" },
      { id: "inv-2", name: "Eggs", quantity: 0, lowStockThreshold: 6, unit: "pcs" },
    ]);
    shoppingListItemFindManyMock
      // Nothing pending on this list yet.
      .mockResolvedValueOnce([])
      // Two litres of milk ticked on another list, not put away.
      .mockResolvedValueOnce([
        {
          inventoryItemId: "inv-1",
          quantity: 2,
          purchased: true,
          putAwayAt: null,
          checkedOffAt: new Date(),
          priceRecordedAt: null,
          shoppingList: { status: "ACTIVE", completedAt: null },
        },
      ]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ inventoryItemId: "inv-2" })],
    });
    expect(shoppingListItemFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchased: true,
          putAwayAt: null,
          shoppingList: { householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } },
        }),
      }),
    );
  });
});
