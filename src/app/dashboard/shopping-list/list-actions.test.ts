// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of the shopping-list lifecycle (create, rename, archive, delete, generate from low stock, complete, uncomplete) in
// src/app/dashboard/shopping-list/list-actions.ts, indirectly through the
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
  createShoppingListAction,
  renameShoppingListAction,
  archiveShoppingListAction,
  deleteShoppingListAction,
  generateFromLowStockAction,
  completeShoppingListAction,
  uncompleteShoppingListAction,
} = await import("@/app/dashboard/shopping-list/list-actions");
const { getLocale } = await import("@/lib/i18n/get-dictionary");

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

  // UX-15: the date is written in the viewer's language, not the server's
  // default locale ("10/5/2026").
  it("dates the default name in the viewer's locale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 12));
    vi.mocked(getLocale).mockResolvedValueOnce("sv");
    shoppingListCreateMock.mockResolvedValue({ id: "list-1" });

    try {
      await expect(createShoppingListAction({}, formData({}))).rejects.toThrow("REDIRECT:");
    } finally {
      vi.useRealTimers();
    }

    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Shopping list — 5 okt. 2026" }),
      }),
    );
  });
});

describe("createShoppingListAction start-from (UX-85)", () => {
  it("copies a template's rows and takes its name when none is typed", async () => {
    shoppingListTemplateFindFirstMock.mockResolvedValue({
      name: "BBQ",
      items: [{ name: "Sausages", quantity: 2, unit: "pack", inventoryItemId: null }],
    });
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListCreateMock.mockResolvedValue({ id: "list-2" });

    await expect(
      createShoppingListAction({}, formData({ start: "template:tpl-1" })),
    ).rejects.toThrow("REDIRECT:/dashboard/shopping-list/list-2");

    expect(shoppingListTemplateFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tpl-1", householdId: "household-1" } }),
    );
    const data = shoppingListCreateMock.mock.calls[0][0].data;
    expect(data.name).toBe("BBQ");
    expect(data.items.create).toEqual([expect.objectContaining({ name: "Sausages", quantity: 2, unit: "pack" })]);
  });

  it("keeps a typed name over the template's", async () => {
    shoppingListTemplateFindFirstMock.mockResolvedValue({ name: "BBQ", items: [] });
    shoppingListCreateMock.mockResolvedValue({ id: "list-2" });

    await expect(
      createShoppingListAction({}, formData({ start: "template:tpl-1", name: "Saturday" })),
    ).rejects.toThrow("REDIRECT:");

    expect(shoppingListCreateMock.mock.calls[0][0].data.name).toBe("Saturday");
  });

  it("refuses another household's template", async () => {
    shoppingListTemplateFindFirstMock.mockResolvedValue(null);
    const result = await createShoppingListAction({}, formData({ start: "template:theirs" }));
    expect(result.error).toBeTruthy();
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
  });

  it("copies only the unbought rows of a past list by default, unticked, with notes", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      items: [{ name: "Milk", quantity: 1, unit: "l", inventoryItemId: null, note: "oat", purchased: false }],
    });
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListCreateMock.mockResolvedValue({ id: "list-3" });

    await expect(createShoppingListAction({}, formData({ start: "list:old-1" }))).rejects.toThrow("REDIRECT:");

    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old-1", householdId: "household-1" },
        include: { items: expect.objectContaining({ where: { purchased: false } }) },
      }),
    );
    const data = shoppingListCreateMock.mock.calls[0][0].data;
    expect(data.name).toContain("Shopping list");
    expect(data.items.create).toEqual([expect.objectContaining({ name: "Milk", note: "oat" })]);
    expect(data.items.create[0]).not.toHaveProperty("purchased");
  });

  it("copies every row when asked for all items", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ items: [] });
    shoppingListCreateMock.mockResolvedValue({ id: "list-3" });

    await expect(
      createShoppingListAction({}, formData({ start: "list:old-1", items: "all" })),
    ).rejects.toThrow("REDIRECT:");

    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ include: { items: expect.objectContaining({ where: {} }) } }),
    );
  });

  it("refuses another household's list", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);
    const result = await createShoppingListAction({}, formData({ start: "list:theirs" }));
    expect(result.error).toBeTruthy();
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
  });
});

describe("renameShoppingListAction (UX-85)", () => {
  it("renames within the caller's household and trims the name", async () => {
    shoppingListUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await renameShoppingListAction({}, formData({ listId: "list-1", name: "  Weekly shop  " }));

    expect(result).toEqual({});
    expect(shoppingListUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "list-1", householdId: "household-1" },
      data: { name: "Weekly shop" },
    });
  });

  it("rejects an empty or over-long name without writing", async () => {
    expect((await renameShoppingListAction({}, formData({ listId: "list-1", name: "   " }))).error).toBe(
      "Name is required",
    );
    expect(
      (await renameShoppingListAction({}, formData({ listId: "list-1", name: "x".repeat(121) }))).error,
    ).toBe("List name must be 120 characters or fewer");
    expect(shoppingListUpdateManyMock).not.toHaveBeenCalled();
  });

  it("errors when the list isn't the caller's", async () => {
    shoppingListUpdateManyMock.mockResolvedValue({ count: 0 });
    const result = await renameShoppingListAction({}, formData({ listId: "theirs", name: "Mine now" }));
    expect(result.error).toBe("Shopping list not found");
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

  it("archiveShoppingListAction un-defaults the list so un-archiving can't create a second default (AUTO-8)", async () => {
    shoppingListUpdateManyMock.mockResolvedValue({ count: 1 });

    await archiveShoppingListAction("list-1");

    expect(shoppingListUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED", isDefault: false }) }),
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

describe("generateFromLowStockAction", () => {
  it("reports how many low-stock items it added, so the caller can toast a count", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 1, lowStockThreshold: 3, unit: "l" },
      { id: "inv-2", name: "Eggs", quantity: 5, lowStockThreshold: 2, unit: "pcs" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ inventoryItemId: "inv-1", name: "Milk" }),
      ],
    });
  });

  it("reports 0 added (not an error) when nothing is low on stock", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 5, lowStockThreshold: 2, unit: "l" },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(0);
    expect(result.error).toBeUndefined();
    expect(shoppingListItemCreateManyMock).not.toHaveBeenCalled();
  });

  it("defaults each added row's estimatedPrice from its lastKnownPrice (AUTO-4)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 1, lowStockThreshold: 3, unit: "l", lastKnownPrice: 22 },
      { id: "inv-2", name: "Eggs", quantity: 0, lowStockThreshold: 2, unit: "pcs", lastKnownPrice: null },
    ]);
    shoppingListItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 2 });

    await generateFromLowStockAction("list-1");

    const rows = shoppingListItemCreateManyMock.mock.calls[0][0].data;
    expect(rows.find((r: { inventoryItemId: string }) => r.inventoryItemId === "inv-1").estimatedPrice).toBe(44); // 22 a unit x the row's 2 (BUG-3)
    expect(rows.find((r: { inventoryItemId: string }) => r.inventoryItemId === "inv-2").estimatedPrice).toBeUndefined();
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
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
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

  describe("amount override (UX-87)", () => {
    const partialList = () =>
      shoppingListFindFirstMock.mockResolvedValue({
        id: "list-1",
        name: "This week",
        items: [
          { inventoryItemId: "inv-1", purchased: true, estimatedPrice: 24.9 },
          { inventoryItemId: "inv-2", purchased: true, estimatedPrice: null },
        ],
      });

    it("logs the amount the user corrected it to instead of the partial sum", async () => {
      partialList();
      shoppingListUpdateMock.mockResolvedValue({});
      resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
      transactionCreateMock.mockResolvedValue({});

      await completeShoppingListAction("list-1", 180);

      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 180 }) }),
      );
    });

    it("completes without logging anything when the user skips (null)", async () => {
      partialList();
      shoppingListUpdateMock.mockResolvedValue({});

      const result = await completeShoppingListAction("list-1", null);

      expect(shoppingListUpdateMock).toHaveBeenCalled();
      expect(transactionCreateMock).not.toHaveBeenCalled();
      expect(result.expenseLoggedMessage).toBeUndefined();
    });

    it("rejects a negative amount before touching the list", async () => {
      partialList();

      const result = await completeShoppingListAction("list-1", -5);

      expect(result.error).toBeTruthy();
      expect(shoppingListUpdateMock).not.toHaveBeenCalled();
      expect(transactionCreateMock).not.toHaveBeenCalled();
    });
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

  it("completing the default list un-defaults it and starts a fresh default in the same transaction (AUTO-8)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Next shop", isDefault: true, items: [] });
    shoppingListUpdateMock.mockResolvedValue({});
    getOrCreateDefaultShoppingListMock.mockResolvedValue({ id: "list-2", name: "Next shop" });
    const txShoppingListUpdate = vi.fn();
    transactionMock.mockImplementationOnce(async (arg: unknown) =>
      (arg as (tx: unknown) => unknown)({ shoppingList: { update: txShoppingListUpdate } }),
    );

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeUndefined();
    expect(txShoppingListUpdate).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: expect.objectContaining({ status: "COMPLETED", isDefault: false }),
    });
    expect(getOrCreateDefaultShoppingListMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: { update: txShoppingListUpdate } }),
      "household-1",
    );
  });

  it("completing an ordinary named list doesn't create a default list", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Big trip", isDefault: false, items: [] });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(getOrCreateDefaultShoppingListMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → carry over (UX-80)", () => {
  const list = {
    id: "list-1",
    name: "Big trip",
    isDefault: false,
    items: [
      { id: "a", inventoryItemId: "inv-a", purchased: true, estimatedPrice: null },
      { id: "b", inventoryItemId: "inv-b", purchased: false, estimatedPrice: null },
      { id: "c", inventoryItemId: null, purchased: false, estimatedPrice: null },
    ],
  };

  it("moves the unbought rows to the active default list in the completing transaction", async () => {
    shoppingListFindFirstMock.mockResolvedValue(list);
    getOrCreateDefaultShoppingListMock.mockResolvedValue({ id: "list-2", name: "Next shop" });

    const result = await completeShoppingListAction("list-1", undefined, true);

    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["b", "c"] }, shoppingListId: "list-1", purchased: false },
      data: { shoppingListId: "list-2" },
    });
    expect(result.carriedOver).toEqual({ itemIds: ["b", "c"], listId: "list-2", listName: "Next shop" });
  });

  it("leaves a row behind when its inventory item is already pending on the target", async () => {
    shoppingListFindFirstMock.mockResolvedValue(list);
    getOrCreateDefaultShoppingListMock.mockResolvedValue({ id: "list-2", name: "Next shop" });
    txShoppingListItemFindManyMock.mockResolvedValueOnce([{ inventoryItemId: "inv-b" }]);

    const result = await completeShoppingListAction("list-1", undefined, true);

    expect(result.carriedOver?.itemIds).toEqual(["c"]);
  });

  it("completing the default list carries over to the fresh default it just created", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ ...list, isDefault: true });
    getOrCreateDefaultShoppingListMock.mockResolvedValue({ id: "list-2", name: "Next shop" });

    await completeShoppingListAction("list-1", undefined, true);

    expect(getOrCreateDefaultShoppingListMock).toHaveBeenCalledTimes(1);
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { shoppingListId: "list-2" } }),
    );
  });

  it("moves nothing without carryOver, and nothing when every row was bought", async () => {
    shoppingListFindFirstMock.mockResolvedValue(list);
    const without = await completeShoppingListAction("list-1");
    expect(without.carriedOver).toBeUndefined();

    shoppingListFindFirstMock.mockResolvedValue({ ...list, items: [list.items[0]] });
    const allBought = await completeShoppingListAction("list-1", undefined, true);
    expect(allBought.carriedOver).toBeUndefined();
    expect(txShoppingListItemUpdateManyMock).not.toHaveBeenCalled();
  });

  it("undo puts the carried rows back, only unticked ones in this household", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "COMPLETED" });

    await uncompleteShoppingListAction("list-1", undefined, ["b", "c"]);

    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["b", "c"] }, purchased: false, shoppingList: { householdId: "household-1" } },
      data: { shoppingListId: "list-1" },
    });
  });
});

describe("completeShoppingListAction → shopping expense (MAINT-5)", () => {
  const pricedList = {
    id: "list-1",
    name: "This week",
    items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: 20 }],
  };

  it("logs the expense inside the completion transaction, to the resolved category, and names it in the toast", async () => {
    shoppingListFindFirstMock.mockResolvedValue(pricedList);
    shoppingListUpdateMock.mockResolvedValue({});
    resolveShoppingExpenseCategoryMock.mockResolvedValueOnce({ id: "cat-food", name: "Mat" });

    const result = await completeShoppingListAction("list-1");

    expect(transactionMock).toHaveBeenCalledTimes(1);
    // Handed the transaction client, not the global prisma.
    expect(resolveShoppingExpenseCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: expect.anything() }),
      "household-1",
    );
    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-food", amount: 20 }) }),
    );
    expect(result.expenseLoggedMessage).toBe("Logged 20.00 to Mat");
  });

  it("returns a friendly error instead of throwing when the expense can't be written", async () => {
    shoppingListFindFirstMock.mockResolvedValue(pricedList);
    shoppingListUpdateMock.mockResolvedValue({});
    transactionCreateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeTruthy();
    expect(result.transactionId).toBeUndefined();
    // Nothing learned from a completion that rolled back.
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → transactionId", () => {
  it("returns the id of the Groceries expense it logged, so Undo can target exactly that row", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: 20 }],
    });
    shoppingListUpdateMock.mockResolvedValue({});
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
    transactionCreateMock.mockResolvedValue({ id: "txn-1" });

    const result = await completeShoppingListAction("list-1");

    expect(result.transactionId).toBe("txn-1");
  });

  it("returns no transactionId when nothing had a price (no expense logged)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [{ inventoryItemId: "inv-1", purchased: true, estimatedPrice: null }],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    const result = await completeShoppingListAction("list-1");

    expect(result.transactionId).toBeUndefined();
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });
});

describe("uncompleteShoppingListAction", () => {
  it("returns 'List not found' for a list outside the caller's household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await uncompleteShoppingListAction("someone-elses-list", "txn-1");

    expect(result.error).toBe("List not found");
    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses-list", householdId: "household-1" } }),
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("restores ACTIVE and deletes exactly the completion's expense, household-scoped", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "COMPLETED" });

    const result = await uncompleteShoppingListAction("list-1", "txn-1");

    expect(result).toEqual({});
    expect(shoppingListUpdateMock).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: { status: "ACTIVE", completedAt: null },
    });
    expect(transactionDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "txn-1", householdId: "household-1" },
    });
  });

  it("skips the expense delete when the completion logged none", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "COMPLETED" });

    await uncompleteShoppingListAction("list-1");

    expect(shoppingListUpdateMock).toHaveBeenCalled();
    expect(transactionDeleteManyMock).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op on a list that's no longer COMPLETED (double-tapped Undo)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", status: "ACTIVE" });

    const result = await uncompleteShoppingListAction("list-1", "txn-1");

    expect(result).toEqual({});
    expect(transactionMock).not.toHaveBeenCalled();
    expect(transactionDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("completeShoppingListAction → store-order learning (AUTO-9)", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 10, minute));

  it("folds the hand-ticked sequence into the learned order, keyed by category", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { ...household, categoryOrderLearned: { "auto:produce": 0.05 } },
      userId: "user-1",
    });
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        // Frozen ticked first, produce last: the reverse of the default.
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(9), inventoryItem: { category: "Produce" } },
        // Receipt-applied (no timestamp) and unlinked "Other" rows teach nothing.
        { inventoryItemId: "c", purchased: true, estimatedPrice: null, checkedOffAt: null, inventoryItem: { category: "Bakery" } },
        { inventoryItemId: null, purchased: true, estimatedPrice: null, checkedOffAt: at(5), inventoryItem: null },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(householdUpdateMock).toHaveBeenCalledTimes(1);
    const { where, data } = householdUpdateMock.mock.calls[0][0];
    expect(where).toEqual({ id: "household-1" });
    expect(Object.keys(data.categoryOrderLearned).sort()).toEqual(["auto:frozen", "auto:produce"]);
    // Produce was observed at the far end (0.75), so it moves up from 0.05.
    expect(data.categoryOrderLearned["auto:produce"]).toBeCloseTo(0.05 + 0.3 * (0.75 - 0.05), 4);
  });

  it("writes nothing when the trip touched fewer than two categories", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(2), inventoryItem: { category: "Frozen" } },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});

    await completeShoppingListAction("list-1");

    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("still completes the list when saving what it learned fails", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "This week",
      items: [
        { inventoryItemId: "a", purchased: true, estimatedPrice: null, checkedOffAt: at(1), inventoryItem: { category: "Frozen" } },
        { inventoryItemId: "b", purchased: true, estimatedPrice: null, checkedOffAt: at(2), inventoryItem: { category: "Produce" } },
      ],
    });
    shoppingListUpdateMock.mockResolvedValue({});
    householdUpdateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await completeShoppingListAction("list-1");

    expect(result.error).toBeUndefined();
  });
});

describe("generateFromLowStockAction — incoming stock", () => {
  it("doesn't re-list an item whose shortfall is already in the cart", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Milk", quantity: 0, lowStockThreshold: 2, unit: "l" },
      { id: "inv-2", name: "Eggs", quantity: 0, lowStockThreshold: 6, unit: "pcs" },
    ]);
    shoppingListItemFindManyMock
      // Nothing pending on this list yet.
      .mockResolvedValueOnce([])
      // Two litres of milk ticked on another list, not put away.
      .mockResolvedValueOnce([
        {
          inventoryItemId: "inv-1",
          quantity: 2,
          purchased: true,
          putAwayAt: null,
          checkedOffAt: new Date(),
          priceRecordedAt: null,
          shoppingList: { status: "ACTIVE", completedAt: null },
        },
      ]);
    shoppingListItemCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await generateFromLowStockAction("list-1");

    expect(result.added).toBe(1);
    expect(shoppingListItemCreateManyMock).toHaveBeenCalledWith({
      data: [expect.objectContaining({ inventoryItemId: "inv-2" })],
    });
    expect(shoppingListItemFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchased: true,
          putAwayAt: null,
          shoppingList: { householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } },
        }),
      }),
    );
  });
});
