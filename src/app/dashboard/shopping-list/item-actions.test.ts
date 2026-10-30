// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of adding, editing, linking and deleting shopping-list rows in
// src/app/dashboard/shopping-list/item-actions.ts, indirectly through the
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
  addAdHocItemAction,
  quickAddShoppingListItemAction,
  importShoppingListItemsAction,
  linkShoppingListItemAction,
  createInventoryItemFromShoppingListItemAction,
  updateShoppingListItemAction,
  updateShoppingListItemPriceAction,
  unlinkShoppingListItemAction,
  setShoppingListItemCategoryAction,
  deleteShoppingListItemAction,
  undoAutoAddedItemsAction,
} = await import("@/app/dashboard/shopping-list/item-actions");
// The one cross-module case: a low-stock line must carry no author (GAP-65).
const { generateFromLowStockAction } = await import("@/app/dashboard/shopping-list/list-actions");

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
      data: { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-1", name: "Milk", quantity: 1, unit: "pcs" },
    });
    expect(result.autoLinkedName).toBe("milk");
    // An exact match already resolved it — no need to fetch every inventory
    // item just to try the fuzzy fallback too.
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
  });

  it("stores the session user as addedByUserId and ignores any id the client sends (GAP-65)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", name: "milk" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await addAdHocItemAction(
      {},
      formData({ listId: "list-1", name: "Milk", quantity: "1", addedByUserId: "someone-else" }),
    );
    await quickAddShoppingListItemAction("list-1", "Eggs", 2);

    expect(shoppingListItemCreateMock).toHaveBeenCalledTimes(2);
    for (const [arg] of shoppingListItemCreateMock.mock.calls) {
      expect(arg.data.addedByUserId).toBe("user-1");
    }
  });

  it("leaves addedByUserId unset on lines generated from low stock (GAP-65)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", unit: "l", quantity: 0, lowStockThreshold: 2, lastKnownPrice: null },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);

    await generateFromLowStockAction("list-1");

    const data = shoppingListItemCreateManyMock.mock.calls[0][0].data;
    expect(data[0].addedByUserId).toBeUndefined();
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
      data: { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-1", name: "Milk 1L", quantity: 1, unit: "l" },
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
      data: { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: null, name: "Tomatoe", quantity: 1, unit: "pcs" },
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
        addedByUserId: "user-1",
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
      data: { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-existing", name: "Milk", quantity: 1, unit: "l" },
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
        { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-1", name: "Milk", quantity: 1, unit: "l" },
        { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: null, name: "Mystery item", quantity: 2, unit: "kg" },
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
      data: [{ shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: null, name: "Tomatoe", quantity: 1, unit: "pcs" }],
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

  it("returns a friendly error when the write fails (MAINT-6)", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", shoppingListId: "list-1" });
    shoppingListItemUpdateMock.mockRejectedValueOnce(new Error("connection reset"));

    const result = await unlinkShoppingListItemAction("item-1");

    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("connection reset");
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
