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
  updateManyMock,
  transactionMock,
  revalidatePathMock,
  addToDefaultListOnLowStockMock,
  addItemToDefaultListMock,
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
  updateManyMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(),
  addItemToDefaultListMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    // Interactive transactions run against the same mocked client, so
    // assertions see every write regardless of which client made it.
    $transaction: transactionMock,
    inventoryItem: {
      create: createMock,
      createMany: createManyMock,
      findMany: findManyMock,
      update: updateMock,
      findFirst: findFirstMock,
      findUnique: inventoryItemFindUniqueMock,
      deleteMany: deleteManyMock,
      updateMany: updateManyMock,
    },
    shoppingList: { findFirst: shoppingListFindFirstMock, create: shoppingListCreateMock },
    shoppingListItem: {
      findFirst: shoppingListItemFindFirstMock,
      create: shoppingListItemCreateMock,
      // recordOutOfStockTransition's incoming-stock check
      // (src/lib/incoming-stock.ts): nothing ticked and waiting here.
      findMany: vi.fn(async () => []),
    },
    notification: { findFirst: notificationFindFirstMock, create: notificationCreateMock },
  };
  transactionMock.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
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
// The default-list helpers have their own unit (src/lib/shopping/
// default-list.test.ts) — here we only check which one each action calls,
// with what, and that its result reaches the client.
vi.mock("@/lib/shopping/default-list", () => ({
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  addItemToDefaultList: addItemToDefaultListMock,
  revalidateAutoAdded: vi.fn(),
}));

const {
  createInventoryItemAction,
  updateInventoryItemAction,
  quickAddInventoryItemAction,
  bulkCreateInventoryItemsAction,
  adjustQuantityAction,
  markItemEmptyAction,
  markItemOpenedAction,
  undoMarkItemOpenedAction,
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
        useWithinDaysOpened: null,
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

  // AUTO-7: "editing the date makes it real" means the date, not the form —
  // saving the form for an unrelated reason must not silently turn an
  // existing estimate into a "real" one.
  describe("expiresAtEstimated (AUTO-7)", () => {
    const estimatedDate = new Date("2026-10-01T20:49:39.440Z");

    it("keeps an existing estimate when the submitted date is the same calendar day (an untouched, re-submitted date input)", async () => {
      findFirstMock.mockResolvedValue({
        id: "item-1",
        expiresAt: estimatedDate,
        expiresAtEstimated: true,
      });
      updateMock.mockResolvedValue({});
      // The date input round-trips only the YYYY-MM-DD portion of the
      // estimate — same calendar day, different time of day.
      const fd = formData({ ...validItem, itemId: "item-1", expiresAt: "2026-10-01" });

      await updateInventoryItemAction({}, fd);

      const data = updateMock.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("expiresAtEstimated");
      expect(data.expiresAt).toEqual(new Date("2026-10-01"));
    });

    it("makes the date real when the submitted date is a different day", async () => {
      findFirstMock.mockResolvedValue({
        id: "item-1",
        expiresAt: estimatedDate,
        expiresAtEstimated: true,
      });
      updateMock.mockResolvedValue({});
      const fd = formData({ ...validItem, itemId: "item-1", expiresAt: "2026-11-15" });

      await updateInventoryItemAction({}, fd);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: new Date("2026-11-15"), expiresAtEstimated: false }),
        }),
      );
    });

    it("clears the estimate flag when the date is cleared", async () => {
      findFirstMock.mockResolvedValue({
        id: "item-1",
        expiresAt: estimatedDate,
        expiresAtEstimated: true,
      });
      updateMock.mockResolvedValue({});
      const fd = formData({ ...validItem, itemId: "item-1", expiresAt: "2026-10-01" });
      fd.delete("expiresAt");

      await updateInventoryItemAction({}, fd);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ expiresAt: null, expiresAtEstimated: false }),
        }),
      );
    });
  });
});

describe("useWithinDaysOpened on the item form (GAP-28)", () => {
  it("saves a positive whole number of days", async () => {
    createMock.mockResolvedValue({});

    const result = await createInventoryItemAction({}, formData({ ...validItem, useWithinDaysOpened: "3" }));

    expect(result).toEqual({});
    expect(createMock.mock.calls[0][0].data.useWithinDaysOpened).toBe(3);
  });

  it("saves null when left blank", async () => {
    createMock.mockResolvedValue({});

    await createInventoryItemAction({}, formData({ ...validItem, useWithinDaysOpened: "" }));

    expect(createMock.mock.calls[0][0].data.useWithinDaysOpened).toBeNull();
  });

  it.each(["0", "-2", "1.5", "abc"])("rejects %s", async (value) => {
    const result = await createInventoryItemAction({}, formData({ ...validItem, useWithinDaysOpened: value }));

    expect(result.error).toBe("Use-within days must be a whole number above 0");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("drops the window for an item that doesn't expire", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 2, expiresAt: null, expiresAtEstimated: false });
    updateMock.mockResolvedValue({});

    await updateInventoryItemAction(
      {},
      formData({ ...validItem, itemId: "item-1", useWithinDaysOpened: "3", neverExpires: "on" }),
    );

    expect(updateMock.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ shelfLifeDays: -1, useWithinDaysOpened: null }),
    );
  });
});

describe("markItemOpenedAction (GAP-28)", () => {
  const unopened = {
    id: "item-1",
    householdId: "household-1",
    openedAt: null,
    useWithinDaysOpened: 3,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    expiresAtEstimated: false,
  };

  it("scopes the lookup to the caller's household and refuses another household's item", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await markItemOpenedAction("other-household-item");

    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "other-household-item", householdId: "household-1" } });
    expect(result).toEqual({ error: "Item not found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sets openedAt, pulls expiresAt in and returns the previous values for Undo", async () => {
    findFirstMock.mockResolvedValue(unopened);
    updateMock.mockResolvedValue({});

    const before = Date.now();
    const result = await markItemOpenedAction("item-1");

    expect(result.error).toBeUndefined();
    const data = updateMock.mock.calls[0][0].data;
    expect(updateMock.mock.calls[0][0].where).toEqual({ id: "item-1" });
    expect(data.openedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.expiresAt.getTime()).toBe(data.openedAt.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.updatedByUserId).toBe("user-1");
    expect(result.openedAt).toEqual(data.openedAt);
    expect(result.expiresAt).toEqual(data.expiresAt);
    expect(result.previous).toEqual({
      openedAt: null,
      expiresAt: unopened.expiresAt,
      expiresAtEstimated: false,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory");
  });

  it("refuses an item that's already opened, so a double click can't restart the clock", async () => {
    findFirstMock.mockResolvedValue({ ...unopened, openedAt: new Date("2026-09-20T00:00:00Z") });

    const result = await markItemOpenedAction("item-1");

    expect(result.error).toBe("Item is already opened");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses an item with no use-within window", async () => {
    findFirstMock.mockResolvedValue({ ...unopened, useWithinDaysOpened: null });

    const result = await markItemOpenedAction("item-1");

    expect(result.error).toBe("Item has no use-within days set");
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("undoMarkItemOpenedAction (GAP-28)", () => {
  const markedOpenedAt = new Date("2026-09-25T10:00:00Z");
  const previous = { openedAt: null, expiresAt: new Date("2030-01-01T00:00:00Z"), expiresAtEstimated: false };

  it("restores the previous expiry fields while the item still carries this click's openedAt", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", openedAt: new Date(markedOpenedAt) });
    updateMock.mockResolvedValue({});

    const result = await undoMarkItemOpenedAction("item-1", markedOpenedAt, previous);

    expect(result).toEqual({});
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "item-1", householdId: "household-1" } });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { ...previous, updatedByUserId: "user-1" },
    });
  });

  it("is a no-op when the item has moved on since (restocked, or re-marked)", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", openedAt: null });

    const result = await undoMarkItemOpenedAction("item-1", markedOpenedAt, previous);

    expect(result).toEqual({});
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses another household's item", async () => {
    findFirstMock.mockResolvedValue(null);

    const result = await undoMarkItemOpenedAction("other-household-item", markedOpenedAt, previous);

    expect(result).toEqual({ error: "Item not found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed snapshot", async () => {
    const result = await undoMarkItemOpenedAction("item-1", markedOpenedAt, {
      openedAt: null,
      expiresAt: "2030-01-01" as unknown as Date,
      expiresAtEstimated: false,
    });

    expect(result).toEqual({ error: "Invalid input" });
    expect(findFirstMock).not.toHaveBeenCalled();
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

  it("plain mark-empty leaves the list to the low-stock auto-add and returns what it added", async () => {
    const item = { id: "item-1", name: "Milk", quantity: 3, lowStockThreshold: 2 };
    findFirstMock.mockResolvedValue(item);
    updateMock.mockResolvedValue({});
    const autoAdded = { shoppingListItemId: "row-1", listId: "default-list", listName: "Next shop", itemName: "Milk" };
    addToDefaultListOnLowStockMock.mockResolvedValue(autoAdded);

    const result = await markItemEmptyAction("item-1", false);

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { quantity: 0, updatedByUserId: "user-1" },
    });
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "item-1", 3, 0);
    expect(addItemToDefaultListMock).not.toHaveBeenCalled();
    expect(result).toEqual({ autoAdded: [autoAdded] });
  });

  it("plain mark-empty returns nothing to undo when the auto-add didn't add anything", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", quantity: 1, lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    const result = await markItemEmptyAction("item-1", false);

    expect(result).toEqual({});
  });

  it("'& add to shopping list' targets the default list explicitly (AUTO-8), not the latest active list", async () => {
    const item = { id: "item-1", name: "Milk", quantity: 1, lowStockThreshold: 2 };
    findFirstMock.mockResolvedValue(item);
    updateMock.mockResolvedValue({});
    addItemToDefaultListMock.mockResolvedValue({
      list: { id: "default-list", name: "Next shop" },
      created: { shoppingListItemId: "row-1" },
    });

    const result = await markItemEmptyAction("item-1", true);

    // Explicit request: added as a person's own row (not flagged
    // addedAutomatically), sized as if the item were at 0, and the
    // auto-add path isn't consulted at all.
    expect(addItemToDefaultListMock).toHaveBeenCalledWith(
      expect.anything(),
      "household-1",
      { ...item, quantity: 0 },
      false,
    );
    expect(addToDefaultListOnLowStockMock).not.toHaveBeenCalled();
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
    expect(result).toEqual({ listName: "Next shop" });
  });

  it("still reports the default list when the item was already pending there (deduped)", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", name: "Milk", quantity: 0, lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});
    addItemToDefaultListMock.mockResolvedValue({ list: { id: "default-list", name: "Next shop" }, created: null });

    const result = await markItemEmptyAction("item-1", true);

    expect(result).toEqual({ listName: "Next shop" });
  });
});

describe("low-stock auto-add from quantity changes (AUTO-8)", () => {
  const autoAdded = { shoppingListItemId: "row-1", listId: "default-list", listName: "Next shop", itemName: "Milk" };

  it("adjustQuantityAction passes the before/after quantity and returns the auto-added row", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 3, lowStockThreshold: 3 });
    updateMock.mockResolvedValue({});
    addToDefaultListOnLowStockMock.mockResolvedValue(autoAdded);

    const result = await adjustQuantityAction("item-1", -1);

    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "item-1", 3, 2);
    expect(result).toEqual({ autoAdded: [autoAdded] });
  });

  it("adjustQuantityAction returns a plain {} when nothing was auto-added", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 3, lowStockThreshold: 1 });
    updateMock.mockResolvedValue({});
    addToDefaultListOnLowStockMock.mockResolvedValue(null);

    expect(await adjustQuantityAction("item-1", -1)).toEqual({});
  });

  it("updateInventoryItemAction checks the edit form's new quantity for a crossing", async () => {
    findFirstMock.mockResolvedValue({ id: "item-1", quantity: 5, lowStockThreshold: 2 });
    updateMock.mockResolvedValue({});
    addToDefaultListOnLowStockMock.mockResolvedValue(autoAdded);

    const result = await updateInventoryItemAction(
      {},
      formData({ itemId: "item-1", name: "Milk", category: "Dairy", quantity: "1", unit: "l", lowStockThreshold: "2" }),
    );

    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "item-1", 5, 1);
    expect(result).toEqual({ autoAdded: [autoAdded] });
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

  it("quick-add never passes the form-only neverExpires flag to Prisma", async () => {
    createMock.mockResolvedValue({});

    await quickAddInventoryItemAction({ name: "Mjölk" });

    expect(createMock.mock.calls[0][0].data).not.toHaveProperty("neverExpires");
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

describe("remembering a scanned barcode on create (AUTO-6)", () => {
  it("stores the form's scanned code on the new item, moving it off any other item first", async () => {
    createMock.mockResolvedValue({});

    await createInventoryItemAction({}, formData({ ...validItem, barcode: "036000291452" }));

    // 12-digit UPC-A is stored in its GTIN-13 form (normalizeBarcode).
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", barcode: "0036000291452" },
      data: { barcode: null },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ householdId: "household-1", name: "Flour", barcode: "0036000291452" }),
    });
  });

  it("ignores a barcode field that isn't barcode-shaped", async () => {
    createMock.mockResolvedValue({});

    await createInventoryItemAction({}, formData({ ...validItem, barcode: "not-a-code" }));

    expect(transactionMock).not.toHaveBeenCalled();
    expect(createMock.mock.calls[0][0].data).not.toHaveProperty("barcode");
  });

  it("bulk-add keeps each scanned row's code, once per code, and releases it from older items", async () => {
    createManyMock.mockResolvedValue({ count: 3 });

    await bulkCreateInventoryItemsAction([
      { name: "Milk", barcode: "7310865004703" },
      { name: "Oat milk", barcode: "7310865004703" },
      { name: "Bread" },
    ]);

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows.map((row: { barcode: string | null }) => row.barcode)).toEqual(["7310865004703", null, null]);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", barcode: "7310865004703" },
      data: { barcode: null },
    });
  });
});
