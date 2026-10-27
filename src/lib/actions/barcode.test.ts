// Tests lookupBarcodeAction's pre-network guards: the household-session
// requirement and the barcode-format validation that short-circuits before
// ever calling Open Food Facts, plus the response mapping (with `fetch`
// stubbed) now that the product's category tags are used too (AUTO-2).
// Also the remembered-barcode actions (AUTO-6): household scoping (IDOR),
// clamping, the move-don't-share link rule, undo, and the AUTO-8
// low-stock auto-add hook. Prisma is mocked —
// no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { sv } from "@/lib/i18n/dictionaries/sv";

const {
  requireHouseholdMock,
  findFirstMock,
  updateMock,
  updateManyMock,
  createMock,
  transactionMock,
  recordOutOfStockTransitionMock,
  addToDefaultListOnLowStockMock,
  resolverMock,
  scheduleAiCategoryFallbackMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  updateManyMock: vi.fn(),
  createMock: vi.fn(),
  transactionMock: vi.fn(),
  recordOutOfStockTransitionMock: vi.fn(),
  addToDefaultListOnLowStockMock: vi.fn(async () => null),
  resolverMock: vi.fn(),
  scheduleAiCategoryFallbackMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
    inventoryItem: { findFirst: findFirstMock, update: updateMock, updateMany: updateManyMock, create: createMock },
    $transaction: transactionMock,
  };
  // Interactive transactions run their callback against the same mocked
  // client, so assertions see every write regardless of which client made it.
  transactionMock.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en) };
});
vi.mock("@/lib/notifications", () => ({ recordOutOfStockTransition: recordOutOfStockTransitionMock }));
vi.mock("@/lib/shopping/default-list", () => ({
  addToDefaultListOnLowStock: addToDefaultListOnLowStockMock,
  revalidateAutoAdded: vi.fn(),
}));
vi.mock("@/lib/inventory/category-resolver", () => ({
  createCategoryResolver: () => resolverMock,
  scheduleAiCategoryFallback: scheduleAiCategoryFallbackMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  lookupBarcodeAction,
  scanStockChangeAction,
  undoScanStockChangeAction,
  linkBarcodeAction,
  createItemFromBarcodeAction,
  findItemByBarcodeAction,
} = await import("@/lib/actions/barcode");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const session = { household: { id: "household-1" }, userId: "user-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue(session);
});
requireHouseholdMock.mockResolvedValue(session);

const milk = { id: "item-1", householdId: "household-1", name: "Milk", unit: "pcs", quantity: 2, barcode: "7310865004703" };

describe("lookupBarcodeAction", () => {
  it("requires an authenticated household session before doing anything else", async () => {
    await lookupBarcodeAction("not-a-real-barcode");
    expect(requireHouseholdMock).toHaveBeenCalled();
  });

  it("returns null without ever calling the network for a malformed barcode", async () => {
    const result = await lookupBarcodeAction("abc");

    expect(result).toEqual({ name: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // AUTO-2: the category tags Open Food Facts already sends back are mapped
  // to an auto-category instead of being thrown away.
  it("maps the product's Open Food Facts category tags to a localized category", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 1,
        product: { product_name: "Mellanmjölk 1,5%", categories_tags: ["en:dairies", "en:milks"] },
      }),
    });

    expect(await lookupBarcodeAction("7310865004703")).toEqual({ name: "Mellanmjölk 1,5%", category: "Dairy & eggs" });
  });

  // PERF-20: repeat scans of a barcode are served from Next's data cache.
  it("asks Next to cache the raw Open Food Facts response for a day", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 1, product: { product_name: "Milk" } }) });

    await lookupBarcodeAction("7310865004703");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://world.openfoodfacts.org/api/v2/product/7310865004703.json",
      expect.objectContaining({ next: { revalidate: 86400 } }),
    );
  });

  it("returns a null category when the tags don't map to anything", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: "Mystery", categories_tags: "not-an-array" } }),
    });

    expect(await lookupBarcodeAction("7310865004703")).toEqual({ name: "Mystery", category: null });
  });
});

describe("scanStockChangeAction (AUTO-6)", () => {
  it("looks the code up only within the caller's household (IDOR guard)", async () => {
    findFirstMock.mockResolvedValueOnce(milk);
    await scanStockChangeAction("7310865004703", 1);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { householdId: "household-1", barcode: "7310865004703" } });
  });

  it("applies +1 to a known item and reports the applied change for Undo", async () => {
    findFirstMock.mockResolvedValueOnce(milk);
    const result = await scanStockChangeAction("7310865004703", 1);

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 3, updatedByUserId: "user-1" } });
    expect(result).toEqual({
      kind: "applied",
      item: { id: "item-1", name: "Milk", unit: "pcs", quantity: 3 },
      appliedDelta: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("floors a 'Used up' scan at zero and reports the change that actually happened", async () => {
    findFirstMock.mockResolvedValueOnce({ ...milk, quantity: 0.5 });
    const result = await scanStockChangeAction("7310865004703", -1);

    expect(updateMock).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 0, updatedByUserId: "user-1" } });
    expect(result).toMatchObject({ kind: "applied", appliedDelta: -0.5 });
    expect(recordOutOfStockTransitionMock).toHaveBeenCalledWith(expect.anything(), "household-1", "item-1", 0.5, 0, "user-1");
    // AUTO-8: same low-stock auto-add as every other decrease.
    expect(addToDefaultListOnLowStockMock).toHaveBeenCalledWith(expect.anything(), "household-1", "item-1", 0.5, 0);
  });

  it("resolves a 12-digit UPC-A decode to the item stored under its GTIN-13 form", async () => {
    findFirstMock.mockResolvedValueOnce(milk);
    await scanStockChangeAction("036000291452", 1);
    expect(findFirstMock).toHaveBeenCalledWith({ where: { householdId: "household-1", barcode: "0036000291452" } });
  });

  it("returns Open Food Facts' suggestion for an unknown code without changing anything", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 1, product: { product_name: "Mellanmjölk", categories_tags: ["en:milks"] } }),
    });

    expect(await scanStockChangeAction("7310865004703", 1)).toEqual({
      kind: "unknown",
      barcode: "7310865004703",
      name: "Mellanmjölk",
      category: "Dairy & eggs",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed code or a zero change before touching the database", async () => {
    expect(await scanStockChangeAction("abc", 1)).toMatchObject({ kind: "error" });
    expect(await scanStockChangeAction("7310865004703", 0)).toMatchObject({ kind: "error" });
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("returns the error in the user's language", async () => {
    vi.mocked(getDictionary).mockResolvedValueOnce(sv as never);
    expect(await scanStockChangeAction("abc", 1)).toEqual({ kind: "error", error: sv.errors.invalidBarcode });
  });
});

describe("undoScanStockChangeAction (AUTO-6)", () => {
  it("returns 'Item not found' for another household's item (IDOR guard)", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    expect(await undoScanStockChangeAction("other-item", 1)).toEqual({ error: "Item not found" });
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "other-item", householdId: "household-1" } });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("reverses the applied change relative to the current quantity", async () => {
    // Someone else tapped + in the meantime: 3 → 4. Undoing our +1 keeps theirs.
    findFirstMock.mockResolvedValueOnce({ ...milk, quantity: 4 });
    const result = await undoScanStockChangeAction("item-1", 1);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 3, updatedByUserId: "user-1" } });
    expect(result.item?.quantity).toBe(3);
  });

  it("puts back a 'Used up' scan", async () => {
    findFirstMock.mockResolvedValueOnce({ ...milk, quantity: 0 });
    await undoScanStockChangeAction("item-1", -1);
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { quantity: 1, updatedByUserId: "user-1" } });
  });

  it("is a no-op for a scan that didn't change anything", async () => {
    findFirstMock.mockResolvedValueOnce({ ...milk, quantity: 0 });
    expect(await undoScanStockChangeAction("item-1", 0)).toEqual({
      item: { id: "item-1", name: "Milk", unit: "pcs", quantity: 0 },
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("linkBarcodeAction (AUTO-6)", () => {
  it("returns an error for another household's item (IDOR guard)", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    expect(await linkBarcodeAction("7310865004703", "other-item", 1)).toEqual({ kind: "error", error: "Item not found" });
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: "other-item", householdId: "household-1" } });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("moves the code off whichever other item held it, then links it and applies the scan", async () => {
    findFirstMock.mockResolvedValueOnce({ ...milk, barcode: null });
    const result = await linkBarcodeAction("7310865004703", "item-1", 1);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", barcode: "7310865004703", id: { not: "item-1" } },
      data: { barcode: null },
    });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { barcode: "7310865004703", quantity: 3, updatedByUserId: "user-1" },
    });
    // Released before it's set, so the unique index never sees two holders.
    expect(updateManyMock.mock.invocationCallOrder[0]).toBeLessThan(updateMock.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ kind: "applied", appliedDelta: 1 });
  });
});

describe("createItemFromBarcodeAction (AUTO-6)", () => {
  it("creates the item in the caller's household with the code, starting at the scan's stock", async () => {
    createMock.mockResolvedValueOnce({ id: "new-1", name: "Mellanmjölk", unit: "pcs" });
    const result = await createItemFromBarcodeAction({
      barcode: "7310865004703",
      name: " Mellanmjölk ",
      category: "Dairy & eggs",
      delta: 1,
    });

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", barcode: "7310865004703" },
      data: { barcode: null },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        name: "Mellanmjölk",
        category: "Dairy & eggs",
        quantity: 1,
        barcode: "7310865004703",
      }),
    });
    expect(resolverMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "applied",
      item: { id: "new-1", name: "Mellanmjölk", unit: "pcs", quantity: 1 },
      appliedDelta: 1,
    });
  });

  it("starts a 'Used up' item at 0 and guesses a category when Open Food Facts had none", async () => {
    resolverMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce({ id: "new-1", name: "Mystery", unit: "pcs" });
    await createItemFromBarcodeAction({ barcode: "7310865004703", name: "Mystery", delta: -1 });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 0, category: "Uncategorized" }),
    });
    expect(scheduleAiCategoryFallbackMock).toHaveBeenCalledWith("household-1", ["Mystery"]);
  });

  it("requires a name", async () => {
    expect(await createItemFromBarcodeAction({ barcode: "7310865004703", name: "  ", delta: 1 })).toMatchObject({
      kind: "error",
    });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("findItemByBarcodeAction (AUTO-6)", () => {
  it("returns a known item from the caller's household without asking Open Food Facts", async () => {
    findFirstMock.mockResolvedValueOnce({ id: "item-1", name: "Milk", unit: "pcs" });
    expect(await findItemByBarcodeAction("7310865004703")).toEqual({
      kind: "known",
      item: { id: "item-1", name: "Milk", unit: "pcs" },
    });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1", barcode: "7310865004703" } }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Open Food Facts for an unknown code", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await findItemByBarcodeAction("7310865004703")).toEqual({
      kind: "unknown",
      barcode: "7310865004703",
      name: null,
      category: null,
    });
  });
});
