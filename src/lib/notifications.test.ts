// Tests recordOutOfStockTransition() and getActiveNotifications()
// (src/lib/notifications.ts) — the two halves of the persisted notification
// model (see the Notification model's doc comment in prisma/schema.prisma).
// Prisma is mocked so this never touches a real database — see
// REQUIREMENTS.md's "Testing" section.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  notificationFindFirstMock,
  notificationCreateMock,
  notificationFindManyMock,
  mealPlanEntryFindManyMock,
  inventoryItemFindUniqueMock,
  sendPushToHouseholdMock,
} = vi.hoisted(() => ({
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
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
    inventoryItem: { findUnique: inventoryItemFindUniqueMock },
  },
}));

// Push delivery is covered by its own unit (src/lib/push.ts) — here we only
// assert notifications.ts calls it with the right payload, fire-and-forget.
vi.mock("@/lib/push", () => ({
  sendPushToHousehold: sendPushToHouseholdMock,
}));

const { recordOutOfStockTransition, getActiveNotifications } = await import("@/lib/notifications");
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

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith("household-1", {
      title: "Out of stock",
      body: "Eggs is out of stock",
      url: "/dashboard/inventory?status=out",
    });
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
});
