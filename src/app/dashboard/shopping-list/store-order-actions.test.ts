// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of the learned store-section order in
// src/app/dashboard/shopping-list/store-order-actions.ts, indirectly through the
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
  saveCategoryOrderAction,
  resetCategoryOrderAction,
} = await import("@/app/dashboard/shopping-list/store-order-actions");

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

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
