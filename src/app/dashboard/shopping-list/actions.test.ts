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
  shoppingListItemFindFirstMock,
  shoppingListItemFindManyMock,
  shoppingListItemCreateMock,
  shoppingListItemCreateManyMock,
  shoppingListItemUpdateMock,
  shoppingListItemDeleteMock,
  priceHistoryCreateMock,
  transactionCreateMock,
  transactionMock,
  notificationFindFirstMock,
  notificationCreateMock,
  inventoryItemFindUniqueMock,
  findOrCreateGroceriesCategoryMock,
  fetchExchangeRateMock,
  redirectMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
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
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  shoppingListItemCreateManyMock: vi.fn(),
  shoppingListItemUpdateMock: vi.fn(),
  shoppingListItemDeleteMock: vi.fn(),
  priceHistoryCreateMock: vi.fn(),
  transactionCreateMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(async (cb: (tx: unknown) => unknown) => {
    const tx = {
      shoppingListItem: { update: shoppingListItemUpdateMock },
      inventoryItem: {
        update: inventoryItemUpdateMock,
        findUnique: inventoryItemFindUniqueMock,
        findFirst: inventoryItemFindFirstMock,
        create: inventoryItemCreateMock,
      },
      priceHistory: { create: priceHistoryCreateMock },
      notification: { findFirst: notificationFindFirstMock, create: notificationCreateMock },
    };
    return cb(tx);
  }),
  findOrCreateGroceriesCategoryMock: vi.fn(),
  fetchExchangeRateMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
}));

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
    },
    shoppingListItem: {
      findFirst: shoppingListItemFindFirstMock,
      findMany: shoppingListItemFindManyMock,
      create: shoppingListItemCreateMock,
      createMany: shoppingListItemCreateManyMock,
      update: shoppingListItemUpdateMock,
      delete: shoppingListItemDeleteMock,
    },
    priceHistory: { create: priceHistoryCreateMock },
    transaction: { create: transactionCreateMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    shoppingList: {
      defaultNamePrefix: "Shopping list",
      expenseDescription: "Groceries: {name}",
      expenseLogged: "Logged a {amount} expense",
      unresolvedNotice: {
        one: "{count} item wasn't linked",
        other: "{count} items weren't linked",
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
vi.mock("@/app/dashboard/budget/actions", () => ({
  findOrCreateGroceriesCategory: findOrCreateGroceriesCategoryMock,
}));
vi.mock("@/lib/exchange-rate", () => ({ fetchExchangeRate: fetchExchangeRateMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createShoppingListAction,
  archiveShoppingListAction,
  deleteShoppingListAction,
  generateFromLowStockAction,
  addAdHocItemAction,
  quickAddShoppingListItemAction,
  linkShoppingListItemAction,
  createInventoryItemFromShoppingListItemAction,
  updateShoppingListItemAction,
  unlinkShoppingListItemAction,
  resolveShoppingListMappingsAction,
  togglePurchasedAction,
  applyReceiptScanAction,
  deleteShoppingListItemAction,
  completeShoppingListAction,
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
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1" });
    shoppingListItemUpdateMock.mockResolvedValue({});

    const result = await linkShoppingListItemAction("item-1", "inv-1");

    expect(result).toEqual({});
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { inventoryItemId: "inv-1" },
    });
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

  it("falls back to 'Uncategorized' for a blank category", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", shoppingListId: "list-1" });
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
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1" });
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
      estimatedPrice: 25,
      inventoryItem: { id: "inv-1", quantity: 2 },
    });

    await togglePurchasedAction("item-1");

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { purchased: true },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 5 },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 25 },
    });
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
  });
});

describe("applyReceiptScanAction", () => {
  const baseList = {
    id: "list-1",
    items: [
      { id: "sli-1", purchased: false, quantity: 2, inventoryItem: { id: "inv-1", quantity: 1 } },
      { id: "sli-2", purchased: true, quantity: 1, inventoryItem: { id: "inv-2", quantity: 5 } },
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
      data: { quantity: 3 }, // 1 + quantity(2)
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
});

describe("deleteShoppingListItemAction", () => {
  it("returns 'Item not found' for an item outside the caller's household", async () => {
    shoppingListItemFindFirstMock.mockResolvedValue(null);

    const result = await deleteShoppingListItemAction("someone-elses-item");

    expect(result.error).toBe("Item not found");
    expect(shoppingListItemDeleteMock).not.toHaveBeenCalled();
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
    findOrCreateGroceriesCategoryMock.mockResolvedValue({ id: "cat-groceries" });
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
});
