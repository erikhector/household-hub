// Tests the module-private itemSchema in
// src/app/dashboard/inventory/actions.ts indirectly through the exported
// Server Actions, plus every action's household-scoping (IDOR) guard. All
// I/O (Prisma, requireHousehold, next/cache, i18n) is mocked — no database
// is touched. See REQUIREMENTS.md's "Testing" section and the identical
// convention in src/lib/actions/household.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  createMock,
  createManyMock,
  findManyMock,
  updateMock,
  findFirstMock,
  deleteManyMock,
  shoppingListFindFirstMock,
  shoppingListCreateMock,
  shoppingListItemFindFirstMock,
  shoppingListItemCreateMock,
  notificationFindFirstMock,
  notificationCreateMock,
  inventoryItemFindUniqueMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  createMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
  deleteManyMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shoppingListCreateMock: vi.fn(),
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: {
      create: createMock,
      createMany: createManyMock,
      findMany: findManyMock,
      update: updateMock,
      findFirst: findFirstMock,
      findUnique: inventoryItemFindUniqueMock,
      deleteMany: deleteManyMock,
    },
    shoppingList: { findFirst: shoppingListFindFirstMock, create: shoppingListCreateMock },
    shoppingListItem: { findFirst: shoppingListItemFindFirstMock, create: shoppingListItemCreateMock },
    notification: { findFirst: notificationFindFirstMock, create: notificationCreateMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return {
    getDictionary: vi.fn(async () => ({
      shoppingList: { defaultNamePrefix: "Shopping list" },
      inventory: { uncategorized: "Uncategorized", autoCategories: en.inventory.autoCategories },
    })),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createInventoryItemAction,
  updateInventoryItemAction,
  quickAddInventoryItemAction,
  bulkCreateInventoryItemsAction,
  adjustQuantityAction,
  markItemEmptyAction,
  deleteInventoryItemAction,
} = await import("@/app/dashboard/inventory/actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const household = { id: "household-1" };
const userId = "user-1";

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId });
  findManyMock.mockResolvedValue([]);
  notificationFindFirstMock.mockResolvedValue(null);
  notificationCreateMock.mockResolvedValue({});
  inventoryItemFindUniqueMock.mockResolvedValue({ name: "Flour" });
});
requireHouseholdMock.mockResolvedValue({ household, userId });

const validItem = {
  name: "Flour",
  category: "Baking",
  quantity: "2",
  unit: "kg",
  lowStockThreshold: "1",
};

describe("createInventoryItemAction validation (itemSchema)", () => {
  it("rejects a missing name", async () => {
    const result = await createInventoryItemAction({}, formData({ ...validItem, name: " " }));
    expect(result.error).toBe("Name is required");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("guesses a blank category from the name instead of rejecting it (AUTO-2)", async () => {
    createMock.mockResolvedValue({});

    const result = await createInventoryItemAction({}, formData({ ...validItem, category: " " }));

    expect(result).toEqual({});
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Pantry basics" }) }),
    );
  });

  it("reuses the household's own category for a name it already has, over the built-in guess", async () => {
    createMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([{ name: "flour", category: "Baking" }]);

    await createInventoryItemAction({}, formData({ ...validItem, category: "" }));

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: household.id } }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Baking" }) }),
    );
  });

  it("falls back to the locale's 'Uncategorized' label when the name can't be guessed", async () => {
    createMock.mockResolvedValue({});

    const result = await createInventoryItemAction({}, formData({ ...validItem, name: "AA batteries", category: " " }));

    expect(result).toEqual({});
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Uncategorized" }) }),
    );
  });

  it("rejects a negative quantity", async () => {
    const result = await createInventoryItemAction({}, formData({ ...validItem, quantity: "-1" }));
    expect(result.error).toBe("Quantity can't be negative");
  });

  it("rejects a negative low-stock threshold", async () => {
    const result = await createInventoryItemAction(
      {},
      formData({ ...validItem, lowStockThreshold: "-1" }),
    );
    expect(result.error).toBe("Threshold can't be negative");
  });

  it("defaults unit to 'pcs' when omitted", async () => {
    createMock.mockResolvedValue({});
    const fd = formData(validItem);
    fd.delete("unit");

    await createInventoryItemAction({}, fd);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ unit: "pcs" }) }),
    );
  });

  it("parses a provided expiresAt date and persists it as a Date", async () => {
    createMock.mockResolvedValue({});

    await createInventoryItemAction({}, formData({ ...validItem, expiresAt: "2026-12-25" }));

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: new Date("2026-12-25") }) }),
    );
  });

  it("defaults expiresAt to null when left blank", async () => {
    createMock.mockResolvedValue({});
    const fd = formData(validItem);
    fd.delete("expiresAt");

    await createInventoryItemAction({}, fd);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }));
  });

  it("creates the item scoped to the caller's household on valid input", async () => {
    createMock.mockResolvedValue({});

    const result = await createInventoryItemAction({}, formData(validItem));

    expect(result).toEqual({});
    expect(createMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "Flour",
        category: "Baking",
        quantity: 2,
        unit: "kg",
        location: undefined,
        lowStockThreshold: 1,
        expiresAt: null,
        expiresAtEstimated: false,
        shelfLifeDays: null,
        updatedByUserId: "user-1",
      },
    });
  });

  // AUTO-7
  it("sets shelfLifeDays to -1 and clears expiresAt when 'doesn't expire' is checked", async () => {
    createMock.mockResolvedValue({});
    const fd = formData({ ...validItem, expiresAt: "2026-12-25" });
    fd.set("neverExpires", "on");

    await createInventoryItemAction({}, fd);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: null, shelfLifeDays: -1 }) }),
    );
  });
});

describe("updateInventoryItemAction", () => {
  it("returns 'Item not found' for an item belonging to another household (IDOR guard)", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await updateInventoryItemAction(
      {},
      formData({ ...validItem, itemId: "other-households-item" }),
    );

    expect(result.error).toBe("Item not found");
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: "other-households-item", householdId: "household-1" },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("nulls out location explicitly when cleared, instead of leaving it stale", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1" });
    updateMock.mockResolvedValue({});
    const fd = formData({ ...validItem, itemId: "item-1" });
    fd.delete("location");

    await updateInventoryItemAction({}, fd);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ location: null }) }),
    );
  });

  it("clears expiresAt back to null when the date input is emptied", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1" });
    updateMock.mockResolvedValue({});
    const fd = formData({ ...validItem, itemId: "item-1", expiresAt: "2026-01-01" });
    fd.delete("expiresAt");

    await updateInventoryItemAction({}, fd);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }),
    );
  });

  it("updates the item when it belongs to the caller's household", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1" });
    updateMock.mockResolvedValue({});

    const result = await updateInventoryItemAction(
      {},
      formData({ ...validItem, itemId: "item-1", location: "Pantry" }),
    );

    expect(result).toEqual({});
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: expect.objectContaining({ location: "Pantry" }),
    });
  });

});

describe("adjustQuantityAction", () => {
  it("returns 'Item not found' for an item belonging to another household (IDOR guard)", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await adjustQuantityAction("other-households-item", 1);

    expect(result.error).toBe("Item not found");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("floors the resulting quantity at zero rather than going negative", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 2 });
    updateMock.mockResolvedValue({});

    await adjustQuantityAction("item-1", -10);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { quantity: 0, updatedByUserId: "user-1" },
    });
  });

  it("adds a positive delta normally", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 2 });
    updateMock.mockResolvedValue({});

    await adjustQuantityAction("item-1", 3);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { quantity: 5, updatedByUserId: "user-1" },
    });
  });

});

describe("markItemEmptyAction", () => {
  it("returns 'Item not found' for an item belonging to another household (IDOR guard)", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await markItemEmptyAction("other-households-item", true);

    expect(result.error).toBe("Item not found");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("zeroes the quantity and does not touch the shopping list when addToShoppingList is false", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});

    const result = await markItemEmptyAction("item-1", false);

    expect(result).toEqual({});
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { quantity: 0, updatedByUserId: "user-1" },
    });
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
  });

  it("does not add a duplicate shopping-list entry for an item already pending on the active list", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "This week" });
    shoppingListItemFindFirstMock.mockResolvedValue({ id: "existing-entry" });

    const result = await markItemEmptyAction("item-1", true);

    expect(result).toEqual({ listName: "This week" });
    expect(shoppingListItemCreateMock).not.toHaveBeenCalled();
  });

  it("creates a new active shopping list when none exists, then adds the item", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});
    shoppingListFindFirstMock.mockResolvedValue(null);
    shoppingListCreateMock.mockResolvedValue({ id: "new-list", name: "Shopping list" });
    shoppingListItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockResolvedValue({});

    const result = await markItemEmptyAction("item-1", true);

    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ householdId: "household-1" }) }),
    );
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "new-list",
        inventoryItemId: "item-1",
        name: "Milk",
        quantity: 2,
      },
    });
    expect(result).toEqual({ listName: "Shopping list" });
  });
});

describe("deleteInventoryItemAction", () => {
  it("scopes the delete to the caller's household (IDOR guard)", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });

    const result = await deleteInventoryItemAction("some-item");

    expect(result).toEqual({});
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { id: "some-item", householdId: "household-1" },
    });
  });
});

describe("auto-categorizing quick-add and bulk-add (AUTO-2)", () => {
  it("quick-add guesses a category when none is given", async () => {
    createMock.mockResolvedValue({});

    await quickAddInventoryItemAction({ name: "Mjölk" });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Dairy & eggs" }) }),
    );
  });

  it("quick-add keeps a category the user typed", async () => {
    createMock.mockResolvedValue({});

    await quickAddInventoryItemAction({ name: "Mjölk", category: "Kylskåp" });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "Kylskåp" }) }),
    );
  });

  it("bulk-add files each item on its own when there's no shared category", async () => {
    createManyMock.mockResolvedValue({ count: 3 });

    await bulkCreateInventoryItemsAction([
      { name: "Bananer" },
      { name: "Zoégas Skånerost", category: "Pantry basics" },
      { name: "AA batteries" },
    ]);

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows.map((row: { category: string }) => row.category)).toEqual([
      "Produce",
      "Pantry basics",
      "Uncategorized",
    ]);
    // The dedupe query doubles as the resolver's household memory — no second read.
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("bulk-add applies a shared category to every item, over any guess or suggestion", async () => {
    createManyMock.mockResolvedValue({ count: 2 });

    await bulkCreateInventoryItemsAction([{ name: "Bananer" }, { name: "Milk", category: "Dairy & eggs" }], {
      category: "Skafferi",
    });

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows.map((row: { category: string }) => row.category)).toEqual(["Skafferi", "Skafferi"]);
  });

  // AUTO-7: a brand-new bulk-created row has no prior expiresAt to protect,
  // so it gets an estimate whenever its (guessed or shared) category has a
  // default shelf life — never for one that doesn't.
  it("bulk-add estimates an expiry for items whose category has a default shelf life", async () => {
    createManyMock.mockResolvedValue({ count: 3 });

    await bulkCreateInventoryItemsAction([
      { name: "Bananer" }, // guesses "Produce" (5 days)
      { name: "Zoégas Skånerost", category: "Pantry basics" }, // no default
      { name: "AA batteries" }, // falls back to "Uncategorized", no default
    ]);

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows[0].expiresAtEstimated).toBe(true);
    expect(rows[0].expiresAt).toBeInstanceOf(Date);
    expect(rows[1].expiresAtEstimated).toBeUndefined();
    expect(rows[2].expiresAtEstimated).toBeUndefined();
  });
});
