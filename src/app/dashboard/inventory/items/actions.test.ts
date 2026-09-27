// The item page's Server Actions (MATCH-6): tenancy on every item,
// conversion and alias id, the factor bounds, and the "Change unit…" maths
// as it reaches the database. All I/O is mocked, as in
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
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    $transaction: transactionMock,
    inventoryItem: { findFirst: itemFindFirstMock, updateMany: itemUpdateManyMock },
    itemUnitConversion: {
      findFirst: conversionFindFirstMock,
      delete: conversionDeleteMock,
      deleteMany: conversionDeleteManyMock,
      createMany: conversionCreateManyMock,
      upsert: conversionUpsertMock,
    },
    itemAlias: { findFirst: aliasFindFirstMock, delete: aliasDeleteMock },
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
const { saveUnitConversionAction, deleteUnitConversionAction, changeItemUnitAction, removeItemAliasAction } =
  await import("@/app/dashboard/inventory/items/actions");

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
