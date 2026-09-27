// The item page's Server Actions (MATCH-6): tenancy on every item,
// conversion and alias id, the factor bounds, and the "Change unit…" maths
// as it reaches the database. Then the catalog's (MATCH-7): "Not
// duplicates", the merge preview and the merge. All I/O is mocked, as in
// src/app/dashboard/inventory/actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  itemFindFirstMock,
  itemUpdateManyMock,
  conversionFindFirstMock,
  conversionDeleteMock,
  conversionDeleteManyMock,
  conversionCreateManyMock,
  conversionUpsertMock,
  aliasFindFirstMock,
  aliasDeleteMock,
  transactionMock,
  revalidatePathMock,
  db,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  itemFindFirstMock: vi.fn(),
  itemUpdateManyMock: vi.fn(),
  conversionFindFirstMock: vi.fn(),
  conversionDeleteMock: vi.fn(),
  conversionDeleteManyMock: vi.fn(),
  conversionCreateManyMock: vi.fn(),
  conversionUpsertMock: vi.fn(),
  aliasFindFirstMock: vi.fn(),
  aliasDeleteMock: vi.fn(),
  transactionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  // The catalog actions' calls, by model and method (MATCH-7).
  db: {
    inventoryItem: { findMany: vi.fn(), count: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    inventoryDuplicateDismissal: { createMany: vi.fn() },
    shoppingListItem: { findMany: vi.fn(), deleteMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    recipeIngredient: { updateMany: vi.fn() },
    shoppingListTemplateItem: { updateMany: vi.fn() },
    priceHistory: { updateMany: vi.fn() },
    itemAlias: { updateMany: vi.fn(), upsert: vi.fn() },
    notification: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    $transaction: transactionMock,
    inventoryItem: { ...db.inventoryItem, findFirst: itemFindFirstMock, updateMany: itemUpdateManyMock },
    inventoryDuplicateDismissal: db.inventoryDuplicateDismissal,
    shoppingListItem: db.shoppingListItem,
    recipeIngredient: db.recipeIngredient,
    shoppingListTemplateItem: db.shoppingListTemplateItem,
    priceHistory: db.priceHistory,
    notification: db.notification,
    itemUnitConversion: {
      findFirst: conversionFindFirstMock,
      delete: conversionDeleteMock,
      deleteMany: conversionDeleteManyMock,
      createMany: conversionCreateManyMock,
      upsert: conversionUpsertMock,
    },
    itemAlias: { ...db.itemAlias, findFirst: aliasFindFirstMock, delete: aliasDeleteMock },
  };
  transactionMock.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en) };
});
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const { en } = await import("@/lib/i18n/dictionaries/en");
const {
  saveUnitConversionAction,
  deleteUnitConversionAction,
  changeItemUnitAction,
  removeItemAliasAction,
  dismissDuplicatesAction,
  previewMergeAction,
  mergeInventoryItemsAction,
} = await import("@/app/dashboard/inventory/items/actions");

const errors = en.inventory.itemPage.errors;
const household = { id: "household-1" };

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

describe("saveUnitConversionAction", () => {
  it("upserts one canonical row per unit for an item in the household", async () => {
    itemFindFirstMock.mockResolvedValue({ id: "item-1", unit: "pcs" });

    const result = await saveUnitConversionAction(
      {},
      formData({ itemId: "item-1", fromUnit: "Grams", factor: "0,0005" }),
    );

    expect(result).toEqual({});
    expect(itemFindFirstMock).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1" },
      select: { id: true, unit: true },
    });
    expect(conversionUpsertMock).toHaveBeenCalledWith({
      where: { inventoryItemId_fromUnit: { inventoryItemId: "item-1", fromUnit: "g" } },
      create: { inventoryItemId: "item-1", fromUnit: "g", factor: 0.0005 },
      update: { factor: 0.0005 },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/inventory/items/item-1");
  });

  it("rejects another household's item", async () => {
    itemFindFirstMock.mockResolvedValue(null);

    const result = await saveUnitConversionAction({}, formData({ itemId: "foreign", fromUnit: "g", factor: "2" }));

    expect(result.error).toBe(errors.notFound);
    expect(conversionUpsertMock).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "", "2000000", "0.0000001"])("rejects the factor %j", async (factor) => {
    itemFindFirstMock.mockResolvedValue({ id: "item-1", unit: "pcs" });

    const result = await saveUnitConversionAction({}, formData({ itemId: "item-1", fromUnit: "g", factor }));

    expect(result.error).toBe(errors.factorRange);
    expect(conversionUpsertMock).not.toHaveBeenCalled();
  });

  it("refuses the item's own unit and a unit the generic table converts", async () => {
    itemFindFirstMock.mockResolvedValue({ id: "item-1", unit: "g" });

    expect((await saveUnitConversionAction({}, formData({ itemId: "item-1", fromUnit: "gram", factor: "1" }))).error).toBe(
      errors.ownUnit,
    );
    expect((await saveUnitConversionAction({}, formData({ itemId: "item-1", fromUnit: "kg", factor: "1000" }))).error).toBe(
      errors.generic,
    );
    expect(conversionUpsertMock).not.toHaveBeenCalled();
  });

  it("edits a row of this item, replacing it when its unit changes", async () => {
    itemFindFirstMock.mockResolvedValue({ id: "item-1", unit: "pcs" });
    conversionFindFirstMock.mockResolvedValue({ id: "conv-1", fromUnit: "dl" });

    await saveUnitConversionAction({}, formData({ itemId: "item-1", conversionId: "conv-1", fromUnit: "cup", factor: "0.1" }));

    expect(conversionFindFirstMock).toHaveBeenCalledWith({
      where: { id: "conv-1", inventoryItemId: "item-1" },
      select: { id: true, fromUnit: true },
    });
    expect(conversionDeleteMock).toHaveBeenCalledWith({ where: { id: "conv-1" } });
    expect(conversionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ create: { inventoryItemId: "item-1", fromUnit: "cup", factor: 0.1 } }),
    );
  });

  it("rejects a conversion id that isn't this item's", async () => {
    itemFindFirstMock.mockResolvedValue({ id: "item-1", unit: "pcs" });
    conversionFindFirstMock.mockResolvedValue(null);

    const result = await saveUnitConversionAction(
      {},
      formData({ itemId: "item-1", conversionId: "foreign-conv", fromUnit: "dl", factor: "0.1" }),
    );

    expect(result.error).toBe(errors.notFound);
    expect(conversionUpsertMock).not.toHaveBeenCalled();
  });
});

describe("deleteUnitConversionAction", () => {
  it("deletes only a conversion whose item is in the household", async () => {
    conversionFindFirstMock.mockResolvedValue({ id: "conv-1", inventoryItemId: "item-1" });

    expect(await deleteUnitConversionAction("conv-1")).toEqual({});
    expect(conversionFindFirstMock).toHaveBeenCalledWith({
      where: { id: "conv-1", inventoryItem: { householdId: "household-1" } },
      select: { id: true, inventoryItemId: true },
    });
    expect(conversionDeleteMock).toHaveBeenCalledWith({ where: { id: "conv-1" } });
  });

  it("rejects another household's conversion", async () => {
    conversionFindFirstMock.mockResolvedValue(null);

    expect((await deleteUnitConversionAction("foreign")).error).toBe(errors.notFound);
    expect(conversionDeleteMock).not.toHaveBeenCalled();
  });
});

describe("changeItemUnitAction", () => {
  const flour = {
    id: "item-1",
    unit: "pcs",
    quantity: 1,
    lowStockThreshold: 0.5,
    unitConversions: [
      { fromUnit: "g", factor: 0.0005 },
      { fromUnit: "dl", factor: 0.03 },
    ],
  };

  it("converts stock and threshold and re-expresses the conversions in one transaction", async () => {
    itemFindFirstMock.mockResolvedValue(flour);
    itemUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await changeItemUnitAction({}, formData({ itemId: "item-1", unit: "g", factor: "2000" }));

    expect(result).toEqual({});
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(itemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "item-1", householdId: "household-1", unit: "pcs", quantity: 1, lowStockThreshold: 0.5 },
      data: { unit: "g", quantity: 2000, lowStockThreshold: 1000, updatedByUserId: "user-1" },
    });
    expect(conversionDeleteManyMock).toHaveBeenCalledWith({ where: { inventoryItemId: "item-1" } });
    expect(conversionCreateManyMock).toHaveBeenCalledWith({
      data: [
        { inventoryItemId: "item-1", fromUnit: "dl", factor: 60 },
        { inventoryItemId: "item-1", fromUnit: "pcs", factor: 2000 },
      ],
    });
  });

  it("rejects another household's item", async () => {
    itemFindFirstMock.mockResolvedValue(null);

    const result = await changeItemUnitAction({}, formData({ itemId: "foreign", unit: "g", factor: "2000" }));

    expect(result.error).toBe(errors.notFound);
    expect(itemFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign", householdId: "household-1" } }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("refuses a factor out of range and the unit it's already in", async () => {
    itemFindFirstMock.mockResolvedValue(flour);

    expect((await changeItemUnitAction({}, formData({ itemId: "item-1", unit: "g", factor: "0" }))).error).toBe(
      errors.factor,
    );
    expect((await changeItemUnitAction({}, formData({ itemId: "item-1", unit: "st", factor: "1" }))).error).toBe(
      errors.sameUnit,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("writes nothing when the stock changed since it was read", async () => {
    itemFindFirstMock.mockResolvedValue(flour);
    itemUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await changeItemUnitAction({}, formData({ itemId: "item-1", unit: "g", factor: "2000" }));

    expect(result.error).toBe(errors.stockChanged);
    expect(conversionDeleteManyMock).not.toHaveBeenCalled();
    expect(conversionCreateManyMock).not.toHaveBeenCalled();
  });
});

describe("removeItemAliasAction", () => {
  it("removes an alias of the household", async () => {
    aliasFindFirstMock.mockResolvedValue({ id: "alias-1", inventoryItemId: "item-1" });

    expect(await removeItemAliasAction("alias-1")).toEqual({});
    expect(aliasFindFirstMock).toHaveBeenCalledWith({
      where: { id: "alias-1", householdId: "household-1" },
      select: { id: true, inventoryItemId: true },
    });
    expect(aliasDeleteMock).toHaveBeenCalledWith({ where: { id: "alias-1" } });
  });

  it("rejects another household's alias", async () => {
    aliasFindFirstMock.mockResolvedValue(null);

    expect((await removeItemAliasAction("foreign")).error).toBe(errors.notFound);
    expect(aliasDeleteMock).not.toHaveBeenCalled();
  });
});

// --- Item catalog (MATCH-7) ---------------------------------------------------

const catalogErrors = en.inventory.catalog.errors;

type Row = {
  id: string;
  name?: string;
  unit?: string;
  quantity?: number;
  barcode?: string | null;
  unitConversions?: { fromUnit: string; factor: number }[];
};

// What loadMergeItems' findMany returns for each id.
function itemRow({ id, name = id, unit = "pcs", quantity = 0, barcode = null, unitConversions = [] }: Row) {
  return {
    id,
    name,
    unit,
    quantity,
    lowStockThreshold: 1,
    lastKnownPrice: null,
    expiresAt: null,
    expiresAtEstimated: false,
    category: "Dairy & eggs",
    barcode,
    unitConversions,
    _count: { recipeIngredients: 2, shoppingListItems: 1, listTemplateItems: 0, priceHistory: 3, aliases: 1, unitConversions: 0 },
  };
}

function mergeHappyPath(rows: Row[]) {
  db.inventoryItem.findMany.mockResolvedValue(rows.map(itemRow));
  itemUpdateManyMock.mockResolvedValue({ count: 1 });
  db.shoppingListItem.findMany.mockResolvedValue([]);
  db.inventoryItem.deleteMany.mockResolvedValue({ count: rows.length - 1 });
}

describe("dismissDuplicatesAction", () => {
  it("stores every pair in the group with its ids sorted", async () => {
    db.inventoryItem.count.mockResolvedValue(3);
    expect(await dismissDuplicatesAction(["c", "a", "b"])).toEqual({});
    expect(db.inventoryItem.count).toHaveBeenCalledWith({
      where: { id: { in: ["c", "a", "b"] }, householdId: household.id },
    });
    expect(db.inventoryDuplicateDismissal.createMany).toHaveBeenCalledWith({
      data: [
        { householdId: household.id, itemAId: "a", itemBId: "c" },
        { householdId: household.id, itemAId: "b", itemBId: "c" },
        { householdId: household.id, itemAId: "a", itemBId: "b" },
      ],
      skipDuplicates: true,
    });
  });

  it("rejects an item from another household", async () => {
    db.inventoryItem.count.mockResolvedValue(1);
    expect(await dismissDuplicatesAction(["mine", "foreign"])).toEqual({ error: catalogErrors.notFound });
    expect(db.inventoryDuplicateDismissal.createMany).not.toHaveBeenCalled();
  });

  it("rejects fewer than two or repeated ids", async () => {
    expect(await dismissDuplicatesAction(["a"])).toEqual({ error: catalogErrors.invalid });
    expect(await dismissDuplicatesAction(["a", "a"])).toEqual({ error: catalogErrors.invalid });
    expect(db.inventoryItem.count).not.toHaveBeenCalled();
  });
});

describe("previewMergeAction", () => {
  it("returns the keeper and each merged item with its counts, from one household-scoped query", async () => {
    db.inventoryItem.findMany.mockResolvedValue([itemRow({ id: "egg", quantity: 12 }), itemRow({ id: "eggs" })]);
    const result = await previewMergeAction("egg", ["eggs"]);
    expect(db.inventoryItem.findMany).toHaveBeenCalledTimes(1);
    expect(db.inventoryItem.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["egg", "eggs"] },
      householdId: household.id,
    });
    expect(result).toMatchObject({
      preview: {
        keeper: { id: "egg", quantity: 12, conversions: [] },
        items: [{ id: "eggs", counts: { recipes: 2, listRows: 1, templates: 0, prices: 3, aliases: 1, conversions: 0 } }],
      },
    });
  });

  it("rejects a foreign keeper or merged id", async () => {
    db.inventoryItem.findMany.mockResolvedValue([itemRow({ id: "egg" })]);
    expect(await previewMergeAction("egg", ["foreign"])).toEqual({ error: catalogErrors.notFound });
    db.inventoryItem.findMany.mockResolvedValue([itemRow({ id: "eggs" })]);
    expect(await previewMergeAction("foreign", ["eggs"])).toEqual({ error: catalogErrors.notFound });
  });

  it("rejects more than ten items and the keeper among the merged", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `item-${i}`);
    expect(await previewMergeAction("keeper", eleven)).toEqual({ error: catalogErrors.tooMany });
    expect(await previewMergeAction("egg", ["eggs", "egg"])).toEqual({ error: catalogErrors.keeperInMerge });
    expect(db.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});

describe("mergeInventoryItemsAction", () => {
  it("rejects a foreign keeper or merged id before writing anything", async () => {
    db.inventoryItem.findMany.mockResolvedValue([itemRow({ id: "egg" })]);
    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "foreign" }] })).toEqual({
      error: catalogErrors.notFound,
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects more than ten items, the keeper among the merged, and bad input", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `item-${i}` }));
    expect(await mergeInventoryItemsAction({ keeperId: "keeper", merge: eleven })).toEqual({
      error: catalogErrors.tooMany,
    });
    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "egg" }] })).toEqual({
      error: catalogErrors.keeperInMerge,
    });
    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs", factor: -1 }] })).toEqual({
      error: catalogErrors.invalid,
    });
    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [] })).toEqual({ error: catalogErrors.invalid });
    expect(db.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it("refuses units that can't convert without a factor", async () => {
    db.inventoryItem.findMany.mockResolvedValue([
      itemRow({ id: "creme", unit: "pcs" }),
      itemRow({ id: "creme-dl", unit: "dl", quantity: 2 }),
    ]);
    expect(await mergeInventoryItemsAction({ keeperId: "creme", merge: [{ id: "creme-dl" }] })).toEqual({
      error: catalogErrors.needsFactor,
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("moves every relation to the keeper in one transaction, then deletes the merged item", async () => {
    mergeHappyPath([{ id: "egg", name: "Egg", quantity: 12 }, { id: "eggs", name: "eggs", quantity: 2 }]);

    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] })).toEqual({});
    expect(transactionMock).toHaveBeenCalledTimes(1);

    expect(itemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "egg", householdId: household.id, quantity: 12, unit: "pcs" },
        data: expect.objectContaining({ quantity: 14, updatedByUserId: "user-1" }),
      }),
    );
    const moved = { inventoryItemId: { in: ["eggs"] } };
    const toKeeper = { data: { inventoryItemId: "egg" } };
    expect(db.recipeIngredient.updateMany).toHaveBeenCalledWith({
      where: { ...moved, recipe: { householdId: household.id } },
      ...toKeeper,
    });
    expect(db.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { ...moved, shoppingList: { householdId: household.id } },
      ...toKeeper,
    });
    expect(db.shoppingListTemplateItem.updateMany).toHaveBeenCalledWith({
      where: { ...moved, template: { householdId: household.id } },
      ...toKeeper,
    });
    expect(db.priceHistory.updateMany).toHaveBeenCalledWith({ where: moved, ...toKeeper });
    expect(db.itemAlias.updateMany).toHaveBeenCalledWith({ where: { ...moved, householdId: household.id }, ...toKeeper });
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { ...moved, householdId: household.id } });
    expect(db.inventoryItem.deleteMany).toHaveBeenCalledWith({
      where: { householdId: household.id, OR: [{ id: "eggs", quantity: 2, unit: "pcs" }] },
    });
  });

  it("writes the merged item's name as an alias of the keeper", async () => {
    mergeHappyPath([{ id: "egg", name: "Egg" }, { id: "eggs", name: "Eggs!" }]);
    await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] });
    expect(db.itemAlias.upsert).toHaveBeenCalledWith({
      where: { householdId_normalizedName: { householdId: household.id, normalizedName: "eggs" } },
      create: { householdId: household.id, normalizedName: "eggs", inventoryItemId: "egg" },
      update: { inventoryItemId: "egg" },
    });
  });

  it("clears the merged barcode first and hands it to a keeper without one", async () => {
    mergeHappyPath([{ id: "egg" }, { id: "eggs", barcode: "7310865004703" }]);
    await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] });
    expect(itemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["eggs"] }, householdId: household.id, barcode: { not: null } },
      data: { barcode: null },
    });
    expect(db.inventoryItem.update).toHaveBeenCalledWith({ where: { id: "egg" }, data: { barcode: "7310865004703" } });
    expect(itemUpdateManyMock.mock.invocationCallOrder[1]).toBeLessThan(
      db.inventoryItem.update.mock.invocationCallOrder[0],
    );
  });

  it("keeps the keeper's barcode", async () => {
    mergeHappyPath([{ id: "egg", barcode: "111" }, { id: "eggs", barcode: "222" }]);
    await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] });
    expect(db.inventoryItem.update).not.toHaveBeenCalled();
  });

  it("saves a typed factor on the keeper and converts the stock with it", async () => {
    mergeHappyPath([
      { id: "creme", unit: "pcs", quantity: 2 },
      { id: "creme-dl", unit: "dl", quantity: 4 },
    ]);
    expect(await mergeInventoryItemsAction({ keeperId: "creme", merge: [{ id: "creme-dl", factor: 0.5 }] })).toEqual({});
    expect(conversionCreateManyMock).toHaveBeenCalledWith({
      data: [{ inventoryItemId: "creme", fromUnit: "dl", factor: 0.5 }],
      skipDuplicates: true,
    });
    expect(itemUpdateManyMock.mock.calls[0][0].data.quantity).toBe(4);
  });

  it("adds a merged pending row into the keeper's row on the same list", async () => {
    mergeHappyPath([{ id: "egg" }, { id: "eggs" }]);
    db.shoppingListItem.findMany.mockResolvedValue([
      { id: "row-k", shoppingListId: "list", inventoryItemId: "egg", quantity: 6, unit: "pcs", estimatedPrice: null, note: null },
      { id: "row-m", shoppingListId: "list", inventoryItemId: "eggs", quantity: 6, unit: "pcs", estimatedPrice: null, note: null },
    ]);
    await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] });
    expect(db.shoppingListItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["row-m"] } } });
    expect(db.shoppingListItem.update).toHaveBeenCalledWith({
      where: { id: "row-k" },
      data: { quantity: 12, estimatedPrice: null, note: null },
    });
  });

  it("rolls back when the stock changed since the preview", async () => {
    mergeHappyPath([{ id: "egg" }, { id: "eggs" }]);
    db.inventoryItem.deleteMany.mockResolvedValue({ count: 0 });
    expect(await mergeInventoryItemsAction({ keeperId: "egg", merge: [{ id: "eggs" }] })).toEqual({
      error: catalogErrors.stockChanged,
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
