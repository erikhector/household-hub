// AUTO-10's chip actions (repurchase-actions.ts): tenancy guards, the add's
// idempotency and defaults, and the dismiss snooze. Prisma, the session,
// next/cache and the history loader are mocked — no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  shoppingListFindFirstMock,
  inventoryItemFindFirstMock,
  inventoryItemUpdateManyMock,
  shoppingListItemFindFirstMock,
  shoppingListItemCreateMock,
  loadRepurchaseRhythmMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  inventoryItemFindFirstMock: vi.fn(),
  inventoryItemUpdateManyMock: vi.fn(),
  shoppingListItemFindFirstMock: vi.fn(),
  shoppingListItemCreateMock: vi.fn(),
  loadRepurchaseRhythmMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingList: { findFirst: shoppingListFindFirstMock },
    inventoryItem: { findFirst: inventoryItemFindFirstMock, updateMany: inventoryItemUpdateManyMock },
    shoppingListItem: { findFirst: shoppingListItemFindFirstMock, create: shoppingListItemCreateMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/inventory/repurchase-suggestions", () => ({ loadRepurchaseRhythm: loadRepurchaseRhythmMock }));
vi.mock("@/lib/actions/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/actions/errors")>()),
  toFriendlyError: () => ({ error: "Something went wrong. Please try again." }),
}));

import {
  addRepurchaseSuggestionAction,
  dismissRepurchaseSuggestionAction,
  undoDismissRepurchaseSuggestionAction,
} from "./repurchase-actions";

const HOUSEHOLD = { id: "hh-1" };
const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function signedIn() {
  requireHouseholdMock.mockResolvedValue({ household: HOUSEHOLD, userId: "user-1" });
}

describe("addRepurchaseSuggestionAction", () => {
  const coffee = { id: "inv-coffee", name: "Coffee", unit: "pkt", lastKnownPrice: 59 };

  it("adds the item with last time's quantity and unit and its last known price", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(coffee);
    shoppingListItemFindFirstMock
      .mockResolvedValueOnce(null) // not already pending
      .mockResolvedValueOnce({ quantity: 2, unit: "pkt" }); // last purchase
    shoppingListItemCreateMock.mockResolvedValue({ id: "row-1" });

    const result = await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(result).toEqual({ itemId: "row-1" });
    expect(shoppingListItemCreateMock).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-1",
        addedByUserId: "user-1",
        inventoryItemId: "inv-coffee",
        name: "Coffee",
        quantity: 2,
        unit: "pkt",
        estimatedPrice: 118,
      },
      select: { id: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/list-1");
  });

  it("scopes the list, the item and the purchase lookup to the session's household", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(coffee);
    shoppingListItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockResolvedValue({ id: "row-1" });

    await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(shoppingListFindFirstMock.mock.calls[0][0].where).toEqual({
      id: "list-1",
      householdId: "hh-1",
      status: "ACTIVE",
    });
    expect(inventoryItemFindFirstMock.mock.calls[0][0].where).toEqual({ id: "inv-coffee", householdId: "hh-1" });
    expect(shoppingListItemFindFirstMock.mock.calls[1][0].where).toMatchObject({
      shoppingList: { householdId: "hh-1" },
    });
  });

  it("falls back to 1 of the item's unit and no price without history", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue({ ...coffee, lastKnownPrice: null });
    shoppingListItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockResolvedValue({ id: "row-1" });

    await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(shoppingListItemCreateMock.mock.calls[0][0].data).toMatchObject({
      quantity: 1,
      unit: "pkt",
      estimatedPrice: undefined,
    });
  });

  it("never marks the row as added automatically", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(coffee);
    shoppingListItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockResolvedValue({ id: "row-1" });

    await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(shoppingListItemCreateMock.mock.calls[0][0].data.addedAutomatically).toBeUndefined();
  });

  it("is a no-op when the item is already pending on the list", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(coffee);
    shoppingListItemFindFirstMock.mockResolvedValueOnce({ id: "row-existing" }).mockResolvedValueOnce(null);

    const result = await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(result).toEqual({ itemId: "row-existing" });
    expect(shoppingListItemCreateMock).not.toHaveBeenCalled();
  });

  it("refuses a list that isn't this household's active list", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue(null);
    inventoryItemFindFirstMock.mockResolvedValue(coffee);

    const result = await addRepurchaseSuggestionAction("foreign-list", "inv-coffee");

    expect(result.error).toBeDefined();
    expect(shoppingListItemCreateMock).not.toHaveBeenCalled();
  });

  it("refuses an item from another household", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(null);

    const result = await addRepurchaseSuggestionAction("list-1", "foreign-item");

    expect(result.error).toBeDefined();
    expect(shoppingListItemCreateMock).not.toHaveBeenCalled();
  });

  it("turns a database failure into a friendly error", async () => {
    signedIn();
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1" });
    inventoryItemFindFirstMock.mockResolvedValue(coffee);
    shoppingListItemFindFirstMock.mockResolvedValue(null);
    shoppingListItemCreateMock.mockRejectedValue(new Error("boom"));

    const result = await addRepurchaseSuggestionAction("list-1", "inv-coffee");

    expect(result).toEqual({ error: "Something went wrong. Please try again." });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("dismissRepurchaseSuggestionAction", () => {
  it("snoozes the item for one usual interval, household-scoped", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-26T12:00:00Z");
    vi.setSystemTime(now);
    signedIn();
    loadRepurchaseRhythmMock.mockResolvedValue({ medianIntervalDays: 12, lastPurchasedAt: now, purchaseCount: 3 });

    const result = await dismissRepurchaseSuggestionAction("inv-coffee");

    expect(result).toEqual({});
    expect(loadRepurchaseRhythmMock).toHaveBeenCalledWith("hh-1", "inv-coffee", now);
    expect(inventoryItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "inv-coffee", householdId: "hh-1" },
      data: { repurchaseSnoozedUntil: new Date(now.getTime() + 12 * DAY_MS) },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/shopping-list/[id]", "page");
  });

  it("leaves an item with no rhythm alone", async () => {
    signedIn();
    loadRepurchaseRhythmMock.mockResolvedValue(null);

    const result = await dismissRepurchaseSuggestionAction("inv-coffee");

    expect(result).toEqual({});
    expect(inventoryItemUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("undoDismissRepurchaseSuggestionAction", () => {
  it("clears the snooze, household-scoped", async () => {
    signedIn();

    const result = await undoDismissRepurchaseSuggestionAction("inv-coffee");

    expect(result).toEqual({});
    expect(inventoryItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "inv-coffee", householdId: "hh-1" },
      data: { repurchaseSnoozedUntil: null },
    });
  });
});
