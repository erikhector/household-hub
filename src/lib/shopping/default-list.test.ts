// Tests the AUTO-8 default-list helpers (src/lib/shopping/default-list.ts):
// lazy creation of the household's "Next shop" list, the dedupe against
// pending rows, and the in-stock → low/out crossing that drives the
// auto-add. Prisma is a plain object of mocks passed in as `db` — the same
// shape callers pass (the prisma client or a transaction's `tx`) — so no
// database is touched. See REQUIREMENTS.md's "Testing" section.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({ shoppingList: { defaultListName: "Next shop" } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { addItemToDefaultList, addToDefaultListOnLowStock, getOrCreateDefaultShoppingList, revalidateAutoAdded } =
  await import("@/lib/shopping/default-list");

const defaultList = { id: "default-list", name: "Next shop" };

function makeDb() {
  return {
    shoppingList: { findFirst: vi.fn(), createMany: vi.fn() },
    shoppingListItem: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    inventoryItem: { findFirst: vi.fn() },
    household: { findUnique: vi.fn() },
  };
}

let db: ReturnType<typeof makeDb>;
// The helpers take the prisma client or a transaction client; the mock
// only implements what they use.
const asDb = () => db as unknown as Parameters<typeof getOrCreateDefaultShoppingList>[0];

beforeEach(() => {
  db = makeDb();
  db.shoppingList.findFirst.mockResolvedValue(defaultList);
  db.shoppingListItem.findFirst.mockResolvedValue(null);
  db.shoppingListItem.create.mockResolvedValue({ id: "new-row" });
  // Nothing ticked off and waiting to be put away (src/lib/incoming-stock.ts).
  db.shoppingListItem.findMany.mockResolvedValue([]);
  db.household.findUnique.mockResolvedValue({ autoAddLowStockToList: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getOrCreateDefaultShoppingList", () => {
  it("returns the existing ACTIVE default without creating anything", async () => {
    const list = await getOrCreateDefaultShoppingList(asDb(), "household-1");

    expect(list).toBe(defaultList);
    expect(db.shoppingList.findFirst).toHaveBeenCalledWith({
      where: { householdId: "household-1", isDefault: true, status: "ACTIVE" },
    });
    expect(db.shoppingList.createMany).not.toHaveBeenCalled();
  });

  it("lazily creates a localized default list, conflict-safe, and re-reads the winner", async () => {
    db.shoppingList.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(defaultList);

    const list = await getOrCreateDefaultShoppingList(asDb(), "household-1");

    expect(db.shoppingList.createMany).toHaveBeenCalledWith({
      data: [{ householdId: "household-1", name: "Next shop", isDefault: true }],
      skipDuplicates: true,
    });
    expect(list).toBe(defaultList);
  });
});

describe("addItemToDefaultList", () => {
  const item = { id: "inv-1", name: "Milk", unit: "l", quantity: 1, lowStockThreshold: 3, lastKnownPrice: 15 };

  it("adds a threshold top-up row with the last known price and returns it", async () => {
    const result = await addItemToDefaultList(asDb(), "household-1", item, true);

    expect(db.shoppingListItem.create).toHaveBeenCalledWith({
      data: {
        shoppingListId: "default-list",
        inventoryItemId: "inv-1",
        name: "Milk",
        quantity: 2,
        unit: "l",
        addedAutomatically: true,
        estimatedPrice: 15,
      },
      select: { id: true },
    });
    expect(result).toEqual({
      list: defaultList,
      created: { shoppingListItemId: "new-row", listId: "default-list", listName: "Next shop", itemName: "Milk" },
    });
  });

  it("never adds less than 1, even with the item at or above its threshold", async () => {
    await addItemToDefaultList(asDb(), "household-1", { ...item, quantity: 5 }, false);

    expect(db.shoppingListItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 1, addedAutomatically: false }) }),
    );
  });

  it("dedupes against a pending row for the same item, like generateFromLowStockAction", async () => {
    db.shoppingListItem.findFirst.mockResolvedValue({ id: "existing" });

    const result = await addItemToDefaultList(asDb(), "household-1", item, true);

    expect(db.shoppingListItem.findFirst).toHaveBeenCalledWith({
      where: { shoppingListId: "default-list", purchased: false, inventoryItemId: "inv-1" },
      select: { id: true },
    });
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
    expect(result.created).toBeNull();
  });
});

describe("addToDefaultListOnLowStock", () => {
  function itemAt(quantity: number, lowStockThreshold = 3) {
    db.inventoryItem.findFirst.mockResolvedValue({
      id: "inv-1",
      name: "Milk",
      unit: "l",
      quantity,
      lowStockThreshold,
      lastKnownPrice: null,
    });
  }

  it("adds on the crossing from in stock into low", async () => {
    itemAt(2);

    const result = await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 3, 2);

    expect(result).toEqual({
      shoppingListItemId: "new-row",
      listId: "default-list",
      listName: "Next shop",
      itemName: "Milk",
    });
    expect(db.shoppingListItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 1, addedAutomatically: true }) }),
    );
    // Scoped to the caller's household — an item id from elsewhere finds nothing.
    expect(db.inventoryItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1", householdId: "household-1" } }),
    );
  });

  it("adds on the crossing from in stock straight to out", async () => {
    itemAt(0);

    const result = await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 5, 0);

    expect(result?.shoppingListItemId).toBe("new-row");
    expect(db.shoppingListItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 3 }) }),
    );
  });

  it("does nothing when an already-low item drops further (no duplicate add)", async () => {
    itemAt(1);

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 2, 1)).toBeNull();
    itemAt(0);
    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 1, 0)).toBeNull();

    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
    expect(db.household.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing when the quantity stays in stock", async () => {
    itemAt(4);

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 6, 4)).toBeNull();
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
  });

  it("skips every query for a restock or unchanged quantity", async () => {
    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 1, 5)).toBeNull();
    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 2, 2)).toBeNull();

    expect(db.inventoryItem.findFirst).not.toHaveBeenCalled();
  });

  it("does nothing when the household turned auto-add off", async () => {
    itemAt(2);
    db.household.findUnique.mockResolvedValue({ autoAddLowStockToList: false });

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 3, 2)).toBeNull();
    expect(db.shoppingList.findFirst).not.toHaveBeenCalled();
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
  });

  it("doesn't duplicate an item already pending on the default list", async () => {
    itemAt(2);
    db.shoppingListItem.findFirst.mockResolvedValue({ id: "existing" });

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 3, 2)).toBeNull();
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
  });

  // Put-away flow: milk in the cart (ticked, not put away) counts as covered.
  it("does nothing when stock on its way home keeps the item in stock", async () => {
    itemAt(2);
    db.shoppingListItem.findMany.mockResolvedValue([
      {
        inventoryItemId: "inv-1",
        quantity: 2,
        purchased: true,
        putAwayAt: null,
        checkedOffAt: new Date(),
        shoppingList: { status: "ACTIVE", completedAt: null },
      },
    ]);

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 3, 2)).toBeNull();
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
    // Only this household's incoming rows, for this item.
    expect(db.shoppingListItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          inventoryItemId: { in: ["inv-1"] },
          purchased: true,
          putAwayAt: null,
          shoppingList: { householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } },
        }),
      }),
    );
  });

  it("still adds when the incoming stock isn't enough to cover the drop", async () => {
    itemAt(0);
    db.shoppingListItem.findMany.mockResolvedValue([
      {
        inventoryItemId: "inv-1",
        quantity: 1,
        purchased: true,
        putAwayAt: null,
        checkedOffAt: new Date(),
        shoppingList: { status: "ACTIVE", completedAt: null },
      },
    ]);

    // 5 + 1 = in stock → 0 + 1 = low (threshold 3).
    const result = await addToDefaultListOnLowStock(asDb(), "household-1", "inv-1", 5, 0);
    expect(result?.shoppingListItemId).toBe("new-row");
  });

  it("does nothing for an item that isn't this household's", async () => {
    db.inventoryItem.findFirst.mockResolvedValue(null);

    expect(await addToDefaultListOnLowStock(asDb(), "household-1", "other-inv", 3, 2)).toBeNull();
    expect(db.shoppingListItem.create).not.toHaveBeenCalled();
  });
});

describe("revalidateAutoAdded", () => {
  it("revalidates each touched list once, plus the overview", () => {
    const added = { shoppingListItemId: "r", listId: "default-list", listName: "Next shop", itemName: "Milk" };

    revalidateAutoAdded([added, { ...added, shoppingListItemId: "r2" }, null]);

    expect(revalidatePathMock).toHaveBeenCalledTimes(2);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/default-list");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list");
  });

  it("does nothing when nothing was added", () => {
    revalidateAutoAdded([null]);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
