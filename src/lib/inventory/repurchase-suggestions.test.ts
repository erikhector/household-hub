// The AUTO-10 history loader: what it asks the database for and how it
// turns rows into repurchase-calc.ts candidates. Prisma is mocked.
import { afterEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { shoppingListItem: { findMany: findManyMock } } }));

import { loadRepurchaseRhythm, loadRepurchaseSuggestions } from "./repurchase-suggestions";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

afterEach(() => vi.clearAllMocks());

type Row = {
  inventoryItemId: string;
  purchased?: boolean;
  checkedOffAt?: Date | null;
  completedAt?: Date | null;
  name?: string;
  snoozedUntil?: Date | null;
};

function purchaseRow({ inventoryItemId, purchased = true, checkedOffAt = null, completedAt = null, name = "Coffee", snoozedUntil = null }: Row) {
  return {
    inventoryItemId,
    purchased,
    checkedOffAt,
    shoppingList: { completedAt },
    inventoryItem: { name, repurchaseSnoozedUntil: snoozedUntil },
  };
}

function mockQueries(purchases: ReturnType<typeof purchaseRow>[], onActiveLists: string[] = []) {
  findManyMock
    .mockResolvedValueOnce(purchases)
    .mockResolvedValueOnce(onActiveLists.map((inventoryItemId) => ({ inventoryItemId })));
}

describe("loadRepurchaseSuggestions", () => {
  it("scopes both queries to the household and a year of history", async () => {
    mockQueries([]);
    await loadRepurchaseSuggestions("hh-1", NOW);

    const since = daysAgo(365);
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      inventoryItemId: { not: null },
      shoppingList: { householdId: "hh-1" },
      purchased: true,
      OR: [{ checkedOffAt: { gte: since } }, { checkedOffAt: null, shoppingList: { completedAt: { gte: since } } }],
    });
    expect(findManyMock.mock.calls[1][0].where).toEqual({
      inventoryItemId: { not: null },
      shoppingList: { householdId: "hh-1", status: "ACTIVE" },
      OR: [{ purchased: false }, { purchased: true, checkedOffAt: null }],
    });
  });

  it("dates hand ticks by checkedOffAt and receipt rows by their list's completion", async () => {
    mockQueries([
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(36), completedAt: daysAgo(35) }),
      purchaseRow({ inventoryItemId: "coffee", completedAt: daysAgo(24) }),
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(12) }),
    ]);

    const result = await loadRepurchaseSuggestions("hh-1", NOW);

    expect(result).toEqual([
      { inventoryItemId: "coffee", name: "Coffee", intervalDays: 12, medianIntervalDays: 12, lastPurchasedAt: daysAgo(12) },
    ]);
  });

  it("skips an item that's on an active list", async () => {
    mockQueries(
      [
        purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(36) }),
        purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(24) }),
        purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(12) }),
      ],
      ["coffee"],
    );

    expect(await loadRepurchaseSuggestions("hh-1", NOW)).toEqual([]);
  });

  it("passes the item's snooze through", async () => {
    mockQueries([
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(36), snoozedUntil: daysAgo(-3) }),
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(24), snoozedUntil: daysAgo(-3) }),
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(12), snoozedUntil: daysAgo(-3) }),
    ]);

    expect(await loadRepurchaseSuggestions("hh-1", NOW)).toEqual([]);
  });
});

describe("loadRepurchaseRhythm", () => {
  it("reads one item's household-scoped history", async () => {
    findManyMock.mockResolvedValueOnce([
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(20) }),
      purchaseRow({ inventoryItemId: "coffee", completedAt: daysAgo(10) }),
      purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(0) }),
    ]);

    const rhythm = await loadRepurchaseRhythm("hh-1", "coffee", NOW);

    expect(rhythm?.medianIntervalDays).toBe(10);
    expect(findManyMock.mock.calls[0][0].where).toMatchObject({
      inventoryItemId: "coffee",
      shoppingList: { householdId: "hh-1" },
      purchased: true,
    });
  });

  it("is null without enough history", async () => {
    findManyMock.mockResolvedValueOnce([purchaseRow({ inventoryItemId: "coffee", checkedOffAt: daysAgo(3) })]);
    expect(await loadRepurchaseRhythm("hh-1", "coffee", NOW)).toBeNull();
  });
});
