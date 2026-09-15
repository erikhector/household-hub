// Tests recordOutOfStockTransition(), recordListClearedTransition() and
// getActiveNotifications()
// (src/lib/notifications.ts) — the persisted notification model (see the
// Notification model's doc comment in prisma/schema.prisma). Prisma is
// mocked so this never touches a real database — see REQUIREMENTS.md's
// "Testing" section.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  notificationFindFirstMock,
  notificationCreateMock,
  notificationFindManyMock,
  mealPlanEntryFindManyMock,
  inventoryItemFindUniqueMock,
  inventoryItemFindManyMock,
  shoppingListFindUniqueMock,
  sendPushToHouseholdMock,
} = vi.hoisted(() => ({
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  shoppingListFindUniqueMock: vi.fn(),
  sendPushToHouseholdMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findFirst: notificationFindFirstMock,
      create: notificationCreateMock,
      findMany: notificationFindManyMock,
    },
    mealPlanEntry: { findMany: mealPlanEntryFindManyMock },
    inventoryItem: { findUnique: inventoryItemFindUniqueMock, findMany: inventoryItemFindManyMock },
    shoppingList: { findUnique: shoppingListFindUniqueMock },
  },
}));

// Push delivery is covered by its own unit (src/lib/push.ts) — here we only
// assert notifications.ts calls it with the right payload, fire-and-forget.
vi.mock("@/lib/push", () => ({
  sendPushToHousehold: sendPushToHouseholdMock,
}));

const { recordOutOfStockTransition, recordListClearedTransition, getActiveNotifications } =
  await import("@/lib/notifications");
const { prisma } = await import("@/lib/prisma");
const { Prisma } = await import("@/generated/prisma/client");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
  notificationFindFirstMock.mockResolvedValue(null);
  notificationCreateMock.mockResolvedValue({});
  notificationFindManyMock.mockResolvedValue([]);
  mealPlanEntryFindManyMock.mockResolvedValue([]);
  inventoryItemFindUniqueMock.mockResolvedValue({ name: "Eggs" });
  inventoryItemFindManyMock.mockResolvedValue([]);
  shoppingListFindUniqueMock.mockResolvedValue({ name: "Weekly shop" });
  sendPushToHouseholdMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("recordOutOfStockTransition", () => {
  it("creates an OUT_OF_STOCK notification when quantity crosses from in-stock to out", async () => {
    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0);

    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "OUT_OF_STOCK", inventoryItemId: "item-1" },
    });
  });

  it("sends a push notification for the newly out-of-stock item", async () => {
    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0);

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      {
        title: "Out of stock",
        body: "Eggs is out of stock",
        url: "/dashboard/inventory?status=out",
      },
      undefined,
    );
  });

  it("excludes the acting user from the push notification", async () => {
    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0, "user-1");

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      expect.objectContaining({ title: "Out of stock" }),
      "user-1",
    );
  });

  it("does nothing when the item was already out of stock", async () => {
    await recordOutOfStockTransition(prisma, "household-1", "item-1", 0, -0);

    expect(notificationFindFirstMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("does nothing when the item doesn't reach zero", async () => {
    await recordOutOfStockTransition(prisma, "household-1", "item-1", 5, 2);

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("does not duplicate an already-active alert for the same item", async () => {
    notificationFindFirstMock.mockResolvedValue({ id: "existing-notif" });

    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0);

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: { inventoryItemId: "item-1", kind: "OUT_OF_STOCK", dismissedAt: null },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });
});

describe("recordListClearedTransition", () => {
  it("creates a LIST_CLEARED notification when pending count crosses from >0 to 0", async () => {
    await recordListClearedTransition(prisma, "household-1", "list-1", 1, 0);

    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "LIST_CLEARED", shoppingListId: "list-1" },
    });
  });

  it("sends a push notification for the newly cleared list", async () => {
    await recordListClearedTransition(prisma, "household-1", "list-1", 1, 0);

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      {
        title: "Shopping list cleared",
        body: "Weekly shop is all checked off",
        url: "/dashboard/shopping-list/list-1",
      },
      undefined,
    );
  });

  it("excludes the acting user from the push notification", async () => {
    await recordListClearedTransition(prisma, "household-1", "list-1", 1, 0, "user-1");

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      expect.objectContaining({ title: "Shopping list cleared" }),
      "user-1",
    );
  });

  it("does nothing when the list was already fully cleared", async () => {
    await recordListClearedTransition(prisma, "household-1", "list-1", 0, 0);

    expect(notificationFindFirstMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("does nothing while pending items remain", async () => {
    await recordListClearedTransition(prisma, "household-1", "list-1", 3, 1);

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("does not duplicate an already-active alert for the same list", async () => {
    notificationFindFirstMock.mockResolvedValue({ id: "existing-notif" });

    await recordListClearedTransition(prisma, "household-1", "list-1", 1, 0);

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: { shoppingListId: "list-1", kind: "LIST_CLEARED", dismissedAt: null },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });
});

describe("getActiveNotifications", () => {
  it("syncs a one-time reminder for past unconsumed meal-plan entries", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { id: "entry-1", date: new Date("2026-09-03T00:00:00.000Z"), freeformName: "Leftovers", recipe: null },
    ]);

    await getActiveNotifications("household-1");

    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith({
      where: {
        mealPlan: { householdId: "household-1" },
        date: { lt: new Date("2026-09-05") },
        consumedAt: null,
        notification: null,
      },
      select: { id: true, date: true, freeformName: true, recipe: { select: { name: true } } },
    });
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "MEAL_NOT_LOGGED", mealPlanEntryId: "entry-1" },
    });
    expect(sendPushToHouseholdMock).toHaveBeenCalledWith("household-1", {
      title: "Did you forget to log a meal?",
      body: "Leftovers",
      url: "/dashboard/meal-planning?week=2026-08-31",
    });
  });

  it("swallows a duplicate-create race during the meal-reminder sync", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([{ id: "entry-1" }]);
    notificationCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    await expect(getActiveNotifications("household-1")).resolves.toEqual([]);
  });

  it("maps an OUT_OF_STOCK row using the linked item's current name", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-1",
        kind: "OUT_OF_STOCK",
        inventoryItemId: "item-1",
        inventoryItem: { name: "Eggs" },
        mealPlanEntry: null,
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([{ id: "notif-1", kind: "outOfStock", itemId: "item-1", name: "Eggs" }]);
  });

  it("drops an OUT_OF_STOCK row whose inventory item no longer exists", async () => {
    notificationFindManyMock.mockResolvedValue([
      { id: "notif-1", kind: "OUT_OF_STOCK", inventoryItemId: "item-1", inventoryItem: null, mealPlanEntry: null },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([]);
  });

  it("maps a MEAL_NOT_LOGGED row, preferring the recipe name over the freeform name", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-2",
        kind: "MEAL_NOT_LOGGED",
        mealPlanEntryId: "entry-1",
        inventoryItem: null,
        mealPlanEntry: {
          date: new Date("2026-09-03T00:00:00.000Z"),
          freeformName: "Leftovers",
          recipe: { name: "Lasagna" },
        },
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([
      {
        id: "notif-2",
        kind: "mealNotLogged",
        entryId: "entry-1",
        dateKey: "2026-09-03",
        weekStartKey: expect.any(String),
        name: "Lasagna",
      },
    ]);
  });

  it("only returns undismissed notifications for the given household", async () => {
    await getActiveNotifications("household-42");

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-42", dismissedAt: null } }),
    );
  });

  it("syncs an EXPIRING_SOON alert for an in-stock item nearing its expiry date", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt" }]);
    notificationFindManyMock.mockResolvedValueOnce([]); // no existing undismissed alert

    await getActiveNotifications("household-1");

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", quantity: { gt: 0 }, expiresAt: { lte: expect.any(Date) } },
      select: { id: true, name: true },
    });
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "EXPIRING_SOON", inventoryItemId: "item-1" },
    });
    expect(sendPushToHouseholdMock).toHaveBeenCalledWith("household-1", {
      title: "Expiring soon",
      body: "Yogurt is expiring soon",
      url: "/dashboard/inventory",
    });
  });

  it("does not duplicate an already-active EXPIRING_SOON alert for the same item", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt" }]);
    notificationFindManyMock.mockResolvedValueOnce([{ inventoryItemId: "item-1" }]);

    await getActiveNotifications("household-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("maps an EXPIRING_SOON row using the linked item's current name", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-3",
        kind: "EXPIRING_SOON",
        inventoryItemId: "item-1",
        inventoryItem: { name: "Yogurt" },
        mealPlanEntry: null,
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([{ id: "notif-3", kind: "expiringSoon", itemId: "item-1", name: "Yogurt" }]);
  });

  it("drops an EXPIRING_SOON row whose inventory item no longer exists", async () => {
    notificationFindManyMock.mockResolvedValue([
      { id: "notif-3", kind: "EXPIRING_SOON", inventoryItemId: "item-1", inventoryItem: null, mealPlanEntry: null },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([]);
  });

  it("always drops legacy RESTOCKED rows (the trigger is retired)", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-4",
        kind: "RESTOCKED",
        inventoryItemId: "item-1",
        inventoryItem: { name: "Eggs" },
        mealPlanEntry: null,
        shoppingList: null,
      },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([]);
  });

  it("maps a LIST_CLEARED row using the linked list's current name", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-5",
        kind: "LIST_CLEARED",
        shoppingListId: "list-1",
        inventoryItem: null,
        mealPlanEntry: null,
        shoppingList: { name: "Weekly shop" },
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([
      { id: "notif-5", kind: "listCleared", shoppingListId: "list-1", name: "Weekly shop" },
    ]);
  });

  it("drops a LIST_CLEARED row whose shopping list no longer exists", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-5",
        kind: "LIST_CLEARED",
        shoppingListId: "list-1",
        inventoryItem: null,
        mealPlanEntry: null,
        shoppingList: null,
      },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([]);
  });
});
