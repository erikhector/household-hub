// Tests the module-private zod schemas plus every IDOR guard and the
// inventory-quantity/PriceHistory side effects of receipt scan and manual receipt registration in
// src/app/dashboard/shopping-list/receipt-actions.ts, indirectly through the
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
  applyReceiptScanAction,
  registerReceiptAction,
} = await import("@/app/dashboard/shopping-list/receipt-actions");

const household = { id: "household-1" };

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

describe("applyReceiptScanAction", () => {
  const baseList = {
    id: "list-1",
    items: [
      { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } },
      { id: "sli-2", purchased: true, quantity: 1, unit: "pcs", inventoryItem: { id: "inv-2", quantity: 5 } },
    ],
  };

  // BUG-3: "3 x Milk 45,00" matched to a "Milk x1" row. 45 is what was
  // paid, so the row is priced at 45, but the unit price is 15.
  it("divides a receipt line's price by the line's own quantity for PriceHistory and lastKnownPrice (BUG-3)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: false, quantity: 1, unit: "l", inventoryItem: { id: "inv-1", quantity: 1 } }],
    });

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 45, quantity: 3 },
    ]);

    expect(result.totalAmount).toBe(45);
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estimatedPrice: 45 }) }),
    );
    // Stock still counts the list row's quantity, as before.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 2, lastKnownPrice: 15 },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 45, quantity: 3, unit: "l", store: null },
    });
    // The spike check compares the unit price, so it must be handed 45 for 3.
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      [{ priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 45, quantity: 3, unit: "l" }],
      "user-1",
    );
  });

  it("falls back to the row's quantity when the match carries an unusable one (BUG-3)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10, quantity: 0 }]);

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: null },
    });
  });

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

  it("sums totalAmount correctly across several matches applied in parallel (SCALE-C)", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } },
        { id: "sli-2", purchased: false, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
        { id: "sli-3", purchased: false, quantity: 3, unit: "pcs", inventoryItem: null },
      ],
    });

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 25 },
      { shoppingListItemId: "sli-3", price: 7.5 },
    ]);

    expect(result.itemsUpdated).toBe(3);
    expect(result.totalAmount).toBe(42.5);
    // AUTO-4: a scanned receipt price also becomes the item's lastKnownPrice.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 3, lastKnownPrice: 5 }, // 10 for the row's 2
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-2" },
      data: { quantity: 6, lastKnownPrice: 25 },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: null },
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-2", price: 25, quantity: 1, unit: "kg", store: null },
    });
    // GAP-9: every row written, as one batch, after the transaction — the
    // unlinked sli-3 wrote no PriceHistory and so isn't in it.
    expect(recordPriceSpikesMock).toHaveBeenCalledTimes(1);
    const [householdId, recorded, actingUserId] = recordPriceSpikesMock.mock.calls[0] as unknown as [
      string,
      { inventoryItemId: string }[],
      string,
    ];
    expect(householdId).toBe("household-1");
    expect(actingUserId).toBe("user-1");
    expect(recorded).toHaveLength(2);
    expect(recorded).toEqual(
      expect.arrayContaining([
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs" },
        { priceHistoryId: "ph-inv-2", inventoryItemId: "inv-2", price: 25, quantity: 1, unit: "kg" },
      ]),
    );
  });

  it("doesn't check for price spikes when the transaction fails", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);
    transactionMock.mockRejectedValueOnce(new Error("boom"));

    // MAINT-6: a failed transaction is a friendly `{ error }`, not a throw.
    const result = await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("boom");
    expect(recordPriceSpikesMock).not.toHaveBeenCalled();
  });

  it("stamps every PriceHistory row it writes with the receipt's store (GAP-6)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    await applyReceiptScanAction(
      "list-1",
      "SEK",
      [{ shoppingListItemId: "sli-1", price: 10 }],
      "  ICA Maxi  ",
    );

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: "ICA Maxi" },
    });
  });

  it("treats a blank/whitespace-only store the same as no store (GAP-6)", async () => {
    shoppingListFindFirstMock.mockResolvedValue(baseList);

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }], "   ");

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 10, quantity: 2, unit: "pcs", store: null },
    });
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
      data: { quantity: 3, lastKnownPrice: 5 }, // 1 + quantity(2); 10 converted, for the row's 2
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

  // AUTO-7
  it("estimates an expiry for a matched line that crosses 0→>0 in a category with a known shelf life", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        {
          id: "sli-1",
          purchased: false,
          quantity: 1,
          inventoryItem: {
            id: "inv-1",
            quantity: 0,
            category: "Meat & fish",
            expiresAt: null,
            expiresAtEstimated: false,
            shelfLifeDays: null,
          },
        },
      ],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });
});

describe("registerReceiptAction", () => {
  it("rejects an empty items array", async () => {
    const result = await registerReceiptAction("My receipt", "SEK", []);

    expect(result.error).toBeTruthy();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // SEC-7: nothing below the 6 MB action body limit caps a receipt, so the
  // schema has to — one over the cap is rejected before any write.
  it("rejects more than 300 receipt lines", async () => {
    const items = Array.from({ length: 301 }, (_, i) => ({
      name: `Item ${i}`,
      quantity: 1,
      unit: "pcs",
      price: 10,
    }));

    const result = await registerReceiptAction("My receipt", "SEK", items);

    expect(result.error).toBe("Too many items");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a line whose quantity or price is absurdly large", async () => {
    const tooMuchQuantity = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 100_001, unit: "l", price: 15 },
    ]);
    const tooHighPrice = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 1, unit: "l", price: 1_000_001 },
    ]);

    expect(tooMuchQuantity.error).toBeTruthy();
    expect(tooHighPrice.error).toBe("Price is too large");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("creates a completed list with items auto-linked by exact name match, updates inventory and logs a Groceries expense", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    resolveShoppingExpenseCategoryMock.mockResolvedValue({ id: "cat-groceries" });
    transactionCreateMock.mockResolvedValue({});

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 2, unit: "l", price: 15 },
    ]);

    expect(shoppingListCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        name: "My receipt",
        status: "COMPLETED",
      }),
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        inventoryItemId: "inv-1",
        name: "Milk",
        quantity: 2,
        unit: "l",
        purchased: true,
        estimatedPrice: 15,
        // Registered after the shop: already home, counted below, and its
        // price recorded — nothing left for the put-away step.
        putAwayAt: expect.any(Date),
        priceRecordedAt: expect.any(Date),
      },
    });
    // AUTO-4: a registered receipt's price also becomes the item's
    // lastKnownPrice.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 4, lastKnownPrice: 7.5 }, // 15 for 2
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l", store: null },
    });
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      [{ priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l" }],
      "user-1",
    );
    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: "cat-groceries", amount: 15, type: "EXPENSE" }),
      }),
    );
    expect(result.unresolvedNotice).toBeUndefined();
    expect(result).toEqual(
      expect.objectContaining({ listId: "list-1", itemsAdded: 1, totalAmount: 15 }),
    );
  });

  it("logs the expense inside the receipt's transaction and returns a friendly error when it can't be written (MAINT-5)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    transactionCreateMock.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Milk", quantity: 2, unit: "l", price: 15 },
    ]);

    // One transaction for stock and expense alike, so the failed insert
    // rolls the stock back too: retrying can't count the milk twice.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(resolveShoppingExpenseCategoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingList: expect.anything() }),
      "household-1",
    );
    expect(result).toEqual({ error: expect.any(String) });
    expect(recordPriceSpikesMock).not.toHaveBeenCalled();
  });

  // AUTO-7
  it("estimates an expiry for a matched line that crosses 0→>0 in a category with a known shelf life", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({
      id: "inv-1",
      quantity: 0,
      unit: "l",
      category: "Dairy & eggs",
      expiresAt: null,
      expiresAtEstimated: false,
      shelfLifeDays: null,
    });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [{ name: "Milk", quantity: 2, unit: "l", price: 15 }]);

    const [[{ data }]] = inventoryItemUpdateMock.mock.calls;
    expect(data.expiresAtEstimated).toBe(true);
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  it("falls back to a default list name and leaves an unmatched item unlinked, reporting it via unresolvedNotice", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "Receipt — today" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction(undefined, "SEK", [
      { name: "Mystery item", quantity: 1, price: 10 },
    ]);

    expect(shoppingListCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: expect.stringContaining("Receipt") }) }),
    );
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        inventoryItemId: null,
        name: "Mystery item",
        quantity: 1,
        unit: "pcs",
        purchased: true,
        estimatedPrice: 10,
        // Unlinked: put away (nothing to count), but no PriceHistory row.
        putAwayAt: expect.any(Date),
      },
    });
    expect(inventoryItemUpdateMock).not.toHaveBeenCalled();
    expect(result.unresolvedNotice).toBe("1 item wasn't linked");
  });

  // PERF-16
  it("loads the household's inventory once for a receipt with several unmatched lines, and still fuzzy-matches in memory", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "inv-1", name: "Whole milk", category: "Dairy & eggs", quantity: 1, unit: "l" },
    ]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Whole milk 1l", quantity: 1, unit: "l", price: 15 },
      { name: "Zzzq", quantity: 1, price: 10 },
      { name: "Xxyw", quantity: 1, price: 10 },
      { name: "Qqvv", quantity: 1, price: 10 },
    ]);

    expect(inventoryItemFindManyMock.mock.calls.filter(([args]) => args?.where?.householdId === "household-1"))
      .toHaveLength(1);
    expect(result.unresolvedNotice).toBe("3 items weren't linked");
  });

  // PERF-16: the lazy read runs after line 1 already created its item, so
  // the read returns that row; it must not be counted twice or the single
  // confident fuzzy match looks like a tie and the line is left unlinked.
  it("still links a later line to an item an earlier line of the same receipt created, with one inventory read", async () => {
    const created = { id: "inv-new", name: "Whole milk", category: "Dairy & eggs", quantity: 0, unit: "pcs" };
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemCreateMock.mockResolvedValue(created);
    inventoryItemFindManyMock.mockResolvedValue([created]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Whole milk", quantity: 1, price: 15, newItemCategory: "Dairy & eggs" },
      { name: "Whole milk 1l", quantity: 1, price: 15 },
    ]);

    expect(inventoryItemFindManyMock.mock.calls.filter(([args]) => args?.where?.householdId === "household-1"))
      .toHaveLength(1);
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("stores lastKnownPrice per unit, not the line total, for a multi-quantity line (BUG-3)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 1, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [{ name: "Milk", quantity: 3, unit: "l", price: 45 }]);

    // The line is still booked at what was paid, and PriceHistory has 45 for 3.
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 3, estimatedPrice: 45 }),
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 45, quantity: 3, unit: "l", store: null },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 4, lastKnownPrice: 15 },
    });
  });

  it("sums quantity across two lines matching the same inventory item instead of overwriting each other", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 10, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [
      { name: "Apple", quantity: 2, price: 5 },
      { name: "Apple", quantity: 3, price: 6 },
    ]);

    expect(inventoryItemUpdateMock).toHaveBeenCalledTimes(1);
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      // AUTO-4: the later of the two lines' prices wins as lastKnownPrice,
      // per unit: 6 for 3 is 2 (BUG-3).
      data: { quantity: 15, lastKnownPrice: 2 }, // 10 + 2 + 3
    });
    expect(priceHistoryCreateMock).toHaveBeenCalledTimes(2);
    // GAP-9: both lines go to recordPriceSpikes in one call, which pools
    // them into one decision for the item.
    expect(recordPriceSpikesMock).toHaveBeenCalledTimes(1);
    expect(recordPriceSpikesMock.mock.calls[0]).toEqual([
      "household-1",
      [
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 5, quantity: 2, unit: "pcs" },
        { priceHistoryId: "ph-inv-1", inventoryItemId: "inv-1", price: 6, quantity: 3, unit: "pcs" },
      ],
      "user-1",
    ]);
  });

  it("stamps every PriceHistory row it writes with the receipt's store, trimmed (GAP-6)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-1", quantity: 2, unit: "l" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction(
      "My receipt",
      "SEK",
      [{ name: "Milk", quantity: 2, unit: "l", price: 15 }],
      "  ICA Maxi  ",
    );

    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 15, quantity: 2, unit: "l", store: "ICA Maxi" },
    });
  });

  it("links to the inventory item the user explicitly matched in review, skipping exact/fuzzy auto-match", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue({ id: "inv-2", quantity: 1, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "ORG BANANAS 2LB", quantity: 1, price: 12, inventoryItemId: "inv-2" },
    ]);

    expect(inventoryItemFindFirstMock).toHaveBeenCalledWith({
      where: { id: "inv-2", householdId: "household-1" },
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ inventoryItemId: "inv-2", name: "ORG BANANAS 2LB" }),
    });
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("creates a new inventory item in the chosen category when the user explicitly chose 'create new'", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new", quantity: 0, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    const result = await registerReceiptAction("My receipt", "SEK", [
      { name: "Kombucha", quantity: 1, unit: "btl", price: 30, newItemCategory: "Beverages" },
    ]);

    expect(inventoryItemFindFirstMock).not.toHaveBeenCalled();
    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: "household-1",
        name: "Kombucha",
        category: "Beverages",
        unit: "btl",
        quantity: 0,
      }),
    });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ inventoryItemId: "inv-new", name: "Kombucha" }),
    });
    expect(result.unresolvedNotice).toBeUndefined();
  });

  it("guesses the category for a 'create new' line whose category was left blank (AUTO-2)", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindManyMock.mockResolvedValue([]);
    inventoryItemCreateMock.mockResolvedValue({ id: "inv-new", quantity: 0, unit: "pcs" });
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });

    await registerReceiptAction("My receipt", "SEK", [
      { name: "Apelsinjuice", quantity: 1, price: 30, newItemCategory: "" },
    ]);

    expect(inventoryItemCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Apelsinjuice", category: "Drinks" }),
    });
  });

  it("converts a foreign-currency price using the fetched exchange rate", async () => {
    shoppingListCreateMock.mockResolvedValue({ id: "list-1", name: "My receipt" });
    inventoryItemFindFirstMock.mockResolvedValue(null);
    inventoryItemFindManyMock.mockResolvedValue([]);
    shoppingListItemCreateMock.mockResolvedValue({ id: "item-1" });
    fetchExchangeRateMock.mockResolvedValue(0.5);

    const result = await registerReceiptAction("My receipt", "EUR", [
      { name: "Cheese", quantity: 1, price: 20 },
    ]);

    expect(fetchExchangeRateMock).toHaveBeenCalledWith("EUR", "SEK");
    expect(result.totalAmount).toBe(10);
  });

  it("returns an error and creates nothing when the exchange rate can't be fetched", async () => {
    fetchExchangeRateMock.mockResolvedValue(null);

    const result = await registerReceiptAction("My receipt", "EUR", [
      { name: "Cheese", quantity: 1, price: 20 },
    ]);

    expect(result.error).toContain("exchange rate");
    expect(shoppingListCreateMock).not.toHaveBeenCalled();
  });
});

describe("applyReceiptScanAction — put-away mode (ON_PUT_AWAY)", () => {
  function asPutAwayHousehold() {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", inventorySyncMode: "ON_PUT_AWAY" },
      userId: "user-1",
    });
  }

  it("records the unit price of a multi-quantity receipt line without touching stock (BUG-3)", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "l", inventoryItem: { id: "inv-1", quantity: 0 } },
      ],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 45, quantity: 3 }]);

    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { lastKnownPrice: 15 } });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-1", price: 45, quantity: 3, unit: "l", store: null },
    });
  });

  it("prices and ticks the rows but leaves the stock for the put-away step", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, putAwayAt: null, priceRecordedAt: null, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } },
        // Ticked in the store, scanned at home — the usual order.
        { id: "sli-2", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
      ],
    });

    const result = await applyReceiptScanAction(
      "list-1",
      "SEK",
      [
        { shoppingListItemId: "sli-1", price: 10 },
        { shoppingListItemId: "sli-2", price: 30 },
      ],
      "ICA",
    );

    expect(result.itemsUpdated).toBe(2);
    // Claimed only while still waiting for a price; an unticked row's
    // reminder goes to whoever applied the receipt.
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "sli-1",
        shoppingListId: "list-1",
        OR: [{ purchased: false }, { putAwayAt: null, priceRecordedAt: null }],
      },
      data: { estimatedPrice: 10, purchased: true, checkedOffByUserId: "user-1" },
    });
    expect(txShoppingListItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estimatedPrice: 30, purchased: true } }),
    );
    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      data: { priceRecordedAt: expect.any(Date) },
    });
    // Only the price moves on the inventory item — no quantity.
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { lastKnownPrice: 5 } });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({ where: { id: "inv-2" }, data: { lastKnownPrice: 30 } });
    expect(priceHistoryCreateMock).toHaveBeenCalledWith({
      data: { inventoryItemId: "inv-2", price: 30, quantity: 1, unit: "kg", store: "ICA" },
    });
    expect(recordPriceSpikesMock).toHaveBeenCalledWith(
      "household-1",
      expect.arrayContaining([expect.objectContaining({ inventoryItemId: "inv-1" })]),
      "user-1",
    );
  });

  it("puts an unlinked row away at once — no PriceHistory, so no priceRecordedAt, and nothing left to match", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "pcs", inventoryItem: null }],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({ where: { id: "sli-1" }, data: { putAwayAt: expect.any(Date) } });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("skips a line whose row a put-away or another receipt claimed first", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: null, quantity: 1, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } }],
    });
    txShoppingListItemUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(result).toEqual({ itemsUpdated: 0, totalAmount: 0 });
    expect(priceHistoryCreateMock).not.toHaveBeenCalled();
  });

  it("won't price a row twice or re-add one already put away", async () => {
    asPutAwayHousehold();
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: true, putAwayAt: null, priceRecordedAt: new Date(), quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 0 } },
        { id: "sli-2", purchased: true, putAwayAt: new Date(), priceRecordedAt: null, quantity: 1, unit: "kg", inventoryItem: { id: "inv-2", quantity: 5 } },
      ],
    });

    const result = await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 30 },
    ]);

    expect(result.error).toBe("Nothing to apply");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("in ON_CHECK mode a receipt line is the arrival, and the row is put away", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [{ id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } }],
    });

    await applyReceiptScanAction("list-1", "SEK", [{ shoppingListItemId: "sli-1", price: 10 }]);

    expect(shoppingListItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "sli-1" },
      data: { priceRecordedAt: expect.any(Date), putAwayAt: expect.any(Date) },
    });
    expect(inventoryItemUpdateMock).toHaveBeenCalledWith({
      where: { id: "inv-1" },
      data: { quantity: 3, lastKnownPrice: 5 },
    });
  });

  it("in ON_CHECK mode two lines for the same inventory item both land, each on the re-read stock", async () => {
    const shared = { id: "inv-1", quantity: 1 };
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      items: [
        { id: "sli-1", purchased: false, quantity: 2, unit: "pcs", inventoryItem: shared },
        { id: "sli-2", purchased: false, quantity: 3, unit: "pcs", inventoryItem: shared },
      ],
    });
    txShoppingListItemFindUniqueMock
      .mockResolvedValueOnce({ id: "sli-1", quantity: 2, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 1 } })
      // After the first line's write inside the same transaction.
      .mockResolvedValueOnce({ id: "sli-2", quantity: 3, unit: "pcs", inventoryItem: { id: "inv-1", quantity: 3 } });

    await applyReceiptScanAction("list-1", "SEK", [
      { shoppingListItemId: "sli-1", price: 10 },
      { shoppingListItemId: "sli-2", price: 12 },
    ]);

    expect(inventoryItemUpdateMock.mock.calls.map(([args]) => args.data.quantity)).toEqual([3, 6]);
  });
});
