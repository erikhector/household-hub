// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of the smart-add bar and its mapping resolution in
// src/app/dashboard/shopping-list/smart-add-actions.ts, indirectly through the
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
  smartAddShoppingListItemsAction,
  resolveShoppingListMappingsAction,
} = await import("@/app/dashboard/shopping-list/smart-add-actions");

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

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
      { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-bread", name: "bröd", quantity: 1, unit: "pcs" },
      { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "inv-milk", name: "mjölk", quantity: 2, unit: "l" },
      { shoppingListId: "list-1", addedByUserId: "user-1", inventoryItemId: "new-Apples", name: "Apples", quantity: 6, unit: "pcs" },
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
