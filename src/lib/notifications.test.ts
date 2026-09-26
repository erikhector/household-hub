// Tests recordOutOfStockTransition(), recordListClearedTransition(),
// recordPriceSpikes(),
// syncMealNotLoggedNotifications(), syncExpiringSoonNotifications() and
// getActiveNotifications()
// (src/lib/notifications.ts) — the persisted notification model (see the
// Notification model's doc comment in prisma/schema.prisma). Prisma is
// mocked so this never touches a real database — see REQUIREMENTS.md's
// "Testing" section.
//
// syncMealNotLoggedNotifications/syncExpiringSoonNotifications are tested
// directly here (they're exported for `/api/cron/sync-notifications` — see
// that route's own test) rather than only through getActiveNotifications,
// which no longer calls either: see this file's SCALE-I doc comment at the
// top of notifications.ts for why the background sync moved off the read
// path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  notificationFindFirstMock,
  notificationCreateMock,
  notificationFindManyMock,
  mealPlanEntryFindManyMock,
  inventoryItemFindUniqueMock,
  inventoryItemFindManyMock,
  shoppingListFindUniqueMock,
  shoppingListFindManyMock,
  shoppingListUpdateManyMock,
  shoppingListItemFindManyMock,
  priceHistoryFindManyMock,
  sendPushToHouseholdMock,
  sendPushToHouseholdMembersMock,
} = vi.hoisted(() => ({
  notificationFindFirstMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(),
  inventoryItemFindUniqueMock: vi.fn(),
  inventoryItemFindManyMock: vi.fn(),
  shoppingListFindUniqueMock: vi.fn(),
  shoppingListFindManyMock: vi.fn(),
  shoppingListUpdateManyMock: vi.fn(),
  shoppingListItemFindManyMock: vi.fn(),
  priceHistoryFindManyMock: vi.fn(),
  sendPushToHouseholdMock: vi.fn(),
  sendPushToHouseholdMembersMock: vi.fn(),
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
    shoppingList: {
      findUnique: shoppingListFindUniqueMock,
      findMany: shoppingListFindManyMock,
      updateMany: shoppingListUpdateManyMock,
    },
    shoppingListItem: { findMany: shoppingListItemFindManyMock },
    priceHistory: { findMany: priceHistoryFindManyMock },
  },
}));

// Push delivery is covered by its own unit (src/lib/push.ts) — here we only
// assert notifications.ts calls it with the right payload — fire-and-forget
// from the action-driven triggers, awaited from the cron-driven syncs (see
// the "waits for" tests below).
vi.mock("@/lib/push", () => ({
  sendPushToHousehold: sendPushToHouseholdMock,
  sendPushToHouseholdMembers: sendPushToHouseholdMembersMock,
}));

// Lets pending promise callbacks run without advancing (fake) timers — used
// to check a sync hasn't resolved while its push send is still pending.
async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// A push send that stays pending until the test releases it.
function pendingPush() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  sendPushToHouseholdMock.mockReturnValue(promise);
  return release;
}

const {
  recordOutOfStockTransition,
  recordListClearedTransition,
  recordPriceSpikes,
  syncMealNotLoggedNotifications,
  syncExpiringSoonNotifications,
  syncPutAwayReminders,
  getActiveNotifications,
} = await import("@/lib/notifications");
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
  priceHistoryFindManyMock.mockResolvedValue([]);
  shoppingListFindManyMock.mockResolvedValue([]);
  shoppingListUpdateManyMock.mockResolvedValue({ count: 1 });
  shoppingListItemFindManyMock.mockResolvedValue([]);
  sendPushToHouseholdMock.mockResolvedValue(undefined);
  sendPushToHouseholdMembersMock.mockResolvedValue(undefined);
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

describe("recordOutOfStockTransition — incoming stock (put-away flow)", () => {
  it("stays quiet while the item is ticked off a list but not put away yet", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      {
        inventoryItemId: "item-1",
        quantity: 2,
        purchased: true,
        putAwayAt: null,
        checkedOffAt: new Date("2026-09-05T11:00:00.000Z"),
        shoppingList: { status: "ACTIVE", completedAt: null },
      },
    ]);

    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0);

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("alerts as usual once the ticked row is too old to count as on its way", async () => {
    shoppingListItemFindManyMock.mockResolvedValue([
      {
        inventoryItemId: "item-1",
        quantity: 2,
        purchased: true,
        putAwayAt: null,
        checkedOffAt: new Date("2026-08-01T11:00:00.000Z"),
        shoppingList: { status: "ACTIVE", completedAt: null },
      },
    ]);

    await recordOutOfStockTransition(prisma, "household-1", "item-1", 3, 0);

    expect(notificationCreateMock).toHaveBeenCalled();
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

describe("recordPriceSpikes", () => {
  // Three earlier purchases of one carton at 20 — the usual price. The
  // thresholds themselves are detectPriceSpike's and tested in
  // src/lib/price-spike.test.ts; these tests cover the wiring around it.
  const history = [10, 20, 30].map((days) => ({
    inventoryItemId: "item-1",
    price: 20,
    quantity: 1,
    unit: "pcs",
    date: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  }));

  function recorded(price: number, overrides: Partial<{ priceHistoryId: string; quantity: number; inventoryItemId: string }> = {}) {
    return {
      priceHistoryId: overrides.priceHistoryId ?? "ph-new",
      inventoryItemId: overrides.inventoryItemId ?? "item-1",
      price,
      quantity: overrides.quantity ?? 1,
      unit: "pcs",
    };
  }

  beforeEach(() => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Milk" }]);
    priceHistoryFindManyMock.mockResolvedValue(history);
  });

  it("creates a PRICE_SPIKE alert with the percentage and pushes it, excluding the acting user", async () => {
    await recordPriceSpikes("household-1", [recorded(35)], "user-1");

    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "PRICE_SPIKE", inventoryItemId: "item-1", priceIncreasePercent: 75 },
    });
    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      { title: "Price jump", body: "Milk cost 75% more than usual", url: "/dashboard/budget?tab=insights" },
      "user-1",
    );
  });

  it("does nothing for an ordinary price", async () => {
    await recordPriceSpikes("household-1", [recorded(21)]);

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("does nothing, without querying, when no price was recorded", async () => {
    await recordPriceSpikes("household-1", []);

    expect(priceHistoryFindManyMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("compares against the item's prior, per-unit-comparable history only, never the rows just written", async () => {
    await recordPriceSpikes("household-1", [recorded(35, { priceHistoryId: "ph-a" }), recorded(35, { priceHistoryId: "ph-b" })]);

    const where = priceHistoryFindManyMock.mock.calls[0][0].where;
    expect(where.inventoryItemId).toEqual({ in: ["item-1"] });
    expect(where.id).toEqual({ notIn: ["ph-a", "ph-b"] });
    expect(where.quantity).toEqual({ not: null });
    expect(where.unit).toEqual({ not: null });
    expect(where.date.gte).toBeInstanceOf(Date);
  });

  it("scopes the item lookup to the household, skipping a foreign item", async () => {
    inventoryItemFindManyMock.mockResolvedValue([]);

    await recordPriceSpikes("household-1", [recorded(35)]);

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["item-1"] }, householdId: "household-1" } }),
    );
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("raises one alert when the same item is on the receipt twice", async () => {
    await recordPriceSpikes("household-1", [
      recorded(35, { priceHistoryId: "ph-a" }),
      recorded(35, { priceHistoryId: "ph-b" }),
    ]);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(sendPushToHouseholdMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't treat buying two cartons at the usual price as a jump", async () => {
    await recordPriceSpikes("household-1", [recorded(40, { quantity: 2 })]);

    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("skips an item with an active or recently-created PRICE_SPIKE alert", async () => {
    notificationFindManyMock.mockResolvedValue([{ inventoryItemId: "item-1" }]);

    await recordPriceSpikes("household-1", [recorded(35)]);

    const where = notificationFindManyMock.mock.calls[0][0].where;
    expect(where).toMatchObject({ householdId: "household-1", kind: "PRICE_SPIKE", inventoryItemId: { in: ["item-1"] } });
    expect(where.OR).toEqual([
      { dismissedAt: null },
      // PRICE_SPIKE_COOLDOWN_DAYS (14) before the faked "now".
      { createdAt: { gte: new Date("2026-08-22T12:00:00.000Z") } },
    ]);
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("still alerts one item when another in the same batch is suppressed", async () => {
    inventoryItemFindManyMock.mockResolvedValue([
      { id: "item-1", name: "Milk" },
      { id: "item-2", name: "Butter" },
    ]);
    priceHistoryFindManyMock.mockResolvedValue([
      ...history,
      ...history.map((row) => ({ ...row, inventoryItemId: "item-2" })),
    ]);
    notificationFindManyMock.mockResolvedValue([{ inventoryItemId: "item-1" }]);

    await recordPriceSpikes("household-1", [recorded(35), recorded(35, { inventoryItemId: "item-2", priceHistoryId: "ph-2" })]);

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "PRICE_SPIKE", inventoryItemId: "item-2", priceIncreasePercent: 75 },
    });
  });

  it("never throws — the prices are already saved", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    priceHistoryFindManyMock.mockRejectedValue(new Error("db down"));

    await expect(recordPriceSpikes("household-1", [recorded(35)])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("waits for the push send before resolving", async () => {
    const release = pendingPush();
    let settled = false;
    const promise = recordPriceSpikes("household-1", [recorded(35)]).then(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(sendPushToHouseholdMock).toHaveBeenCalled();
    expect(settled).toBe(false);

    release();
    await promise;
    expect(settled).toBe(true);
  });
});

describe("syncMealNotLoggedNotifications", () => {
  it("creates a one-time reminder for past unconsumed meal-plan entries", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { id: "entry-1", date: new Date("2026-09-03T00:00:00.000Z"), freeformName: "Leftovers", recipe: null },
    ]);

    await syncMealNotLoggedNotifications("household-1");

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

    await expect(syncMealNotLoggedNotifications("household-1")).resolves.toBeUndefined();
  });

  it("waits for the push send before resolving (so the cron invocation isn't frozen mid-send)", async () => {
    mealPlanEntryFindManyMock.mockResolvedValue([
      { id: "entry-1", date: new Date("2026-09-03T00:00:00.000Z"), freeformName: "Leftovers", recipe: null },
    ]);
    const releasePush = pendingPush();

    let settled = false;
    const sync = syncMealNotLoggedNotifications("household-1").then(() => {
      settled = true;
    });
    await flushMicrotasks();

    expect(sendPushToHouseholdMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releasePush();
    await sync;
    expect(settled).toBe(true);
  });
});

describe("syncExpiringSoonNotifications", () => {
  it("creates an EXPIRING_SOON alert for an in-stock item nearing its expiry date", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt", expiresAtEstimated: false }]);
    notificationFindManyMock.mockResolvedValueOnce([]); // no existing undismissed alert

    await syncExpiringSoonNotifications("household-1");

    expect(inventoryItemFindManyMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", quantity: { gt: 0 }, expiresAt: { lte: expect.any(Date) } },
      select: { id: true, name: true, expiresAtEstimated: true },
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

  // AUTO-7: an estimated expiry still fires the alert (Guardrails: this is
  // an inventory-quantity-adjacent guess worth surfacing), just with
  // softened "probably" push copy — see notification-bell.tsx's
  // notificationLabel for the bell's own equivalent softening.
  it("softens the push copy to 'probably' for an item whose expiry is an estimate", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt", expiresAtEstimated: true }]);
    notificationFindManyMock.mockResolvedValueOnce([]);

    await syncExpiringSoonNotifications("household-1");

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith("household-1", {
      title: "Expiring soon",
      body: "Yogurt is probably expiring soon",
      url: "/dashboard/inventory",
    });
  });

  it("does not duplicate an already-active EXPIRING_SOON alert for the same item", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt" }]);
    notificationFindManyMock.mockResolvedValueOnce([{ inventoryItemId: "item-1" }]);

    await syncExpiringSoonNotifications("household-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("waits for the push send before resolving (so the cron invocation isn't frozen mid-send)", async () => {
    inventoryItemFindManyMock.mockResolvedValue([{ id: "item-1", name: "Yogurt" }]);
    notificationFindManyMock.mockResolvedValueOnce([]);
    const releasePush = pendingPush();

    let settled = false;
    const sync = syncExpiringSoonNotifications("household-1").then(() => {
      settled = true;
    });
    await flushMicrotasks();

    expect(sendPushToHouseholdMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releasePush();
    await sync;
    expect(settled).toBe(true);
  });
});

describe("getActiveNotifications", () => {
  it("is a pure read — no meal-reminder/expiring-soon sync, no writes, no push sends", async () => {
    await getActiveNotifications("household-1");

    expect(mealPlanEntryFindManyMock).not.toHaveBeenCalled();
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
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

  it("maps an EXPIRING_SOON row using the linked item's current name", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-3",
        kind: "EXPIRING_SOON",
        inventoryItemId: "item-1",
        inventoryItem: { name: "Yogurt", expiresAtEstimated: false },
        mealPlanEntry: null,
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([
      { id: "notif-3", kind: "expiringSoon", itemId: "item-1", name: "Yogurt", estimated: false },
    ]);
  });

  // AUTO-7: carries the item's expiresAtEstimated flag through so the bell
  // can soften its wording (see notification-bell.tsx's notificationLabel).
  it("marks an EXPIRING_SOON row as estimated when its expiry is a shelf-life guess", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-3",
        kind: "EXPIRING_SOON",
        inventoryItemId: "item-1",
        inventoryItem: { name: "Yogurt", expiresAtEstimated: true },
        mealPlanEntry: null,
      },
    ]);

    const notifications = await getActiveNotifications("household-1");

    expect(notifications).toEqual([
      { id: "notif-3", kind: "expiringSoon", itemId: "item-1", name: "Yogurt", estimated: true },
    ]);
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

  it("maps a PRICE_SPIKE row using the linked item's current name and stored percentage", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-6",
        kind: "PRICE_SPIKE",
        inventoryItemId: "item-1",
        priceIncreasePercent: 42,
        inventoryItem: { name: "Coffee", expiresAtEstimated: false },
        mealPlanEntry: null,
        shoppingList: null,
      },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([
      { id: "notif-6", kind: "priceSpike", itemId: "item-1", name: "Coffee", increasePercent: 42 },
    ]);
  });

  it("drops a PRICE_SPIKE row whose inventory item no longer exists", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-6",
        kind: "PRICE_SPIKE",
        inventoryItemId: "item-1",
        priceIncreasePercent: 42,
        inventoryItem: null,
        mealPlanEntry: null,
        shoppingList: null,
      },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([]);
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

describe("syncPutAwayReminders", () => {
  // System time is 2026-09-05T12:00Z (see beforeEach).
  const fourHoursAgo = new Date("2026-09-05T08:00:00.000Z");
  const oneHourAgo = new Date("2026-09-05T11:00:00.000Z");

  function listWith(items: { checkedOffAt: Date | null; checkedOffByUserId: string | null }[], remindedAt: Date | null = null) {
    return { id: "list-1", name: "Weekly shop", putAwayRemindedAt: remindedAt, items };
  }

  it("claims the trip, files a bell row and pushes only the member who ticked the rows", async () => {
    shoppingListFindManyMock.mockResolvedValue([
      listWith([
        { checkedOffAt: fourHoursAgo, checkedOffByUserId: "user-2" },
        { checkedOffAt: oneHourAgo, checkedOffByUserId: "user-2" },
      ]),
    ]);

    await syncPutAwayReminders("household-1");

    // Household-scoped query for lists still in play.
    expect(shoppingListFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: "household-1", status: { in: ["ACTIVE", "COMPLETED"] } }),
      }),
    );
    // Claimed against the value this run read, so an overlapping run can't
    // remind for the same trip twice.
    expect(shoppingListUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "list-1", householdId: "household-1", putAwayRemindedAt: null },
      data: { putAwayRemindedAt: new Date("2026-09-05T12:00:00.000Z") },
    });
    expect(notificationCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", kind: "PUT_AWAY_REMINDER", shoppingListId: "list-1" },
    });
    expect(sendPushToHouseholdMembersMock).toHaveBeenCalledWith("household-1", ["user-2"], {
      title: "Put away your shopping?",
      body: "2 items from Weekly shop",
      url: "/dashboard/shopping-list/list-1?putAway=1",
    });
    expect(sendPushToHouseholdMock).not.toHaveBeenCalled();
  });

  it("reminds the whole household when a row was ticked from a share link", async () => {
    shoppingListFindManyMock.mockResolvedValue([listWith([{ checkedOffAt: fourHoursAgo, checkedOffByUserId: null }])]);

    await syncPutAwayReminders("household-1");

    expect(sendPushToHouseholdMock).toHaveBeenCalledWith(
      "household-1",
      expect.objectContaining({ body: "1 item from Weekly shop" }),
    );
    expect(sendPushToHouseholdMembersMock).not.toHaveBeenCalled();
  });

  it("stays quiet for a trip that's too recent or was already reminded", async () => {
    shoppingListFindManyMock.mockResolvedValue([
      listWith([{ checkedOffAt: oneHourAgo, checkedOffByUserId: "user-2" }]),
      { ...listWith([{ checkedOffAt: fourHoursAgo, checkedOffByUserId: "user-2" }], oneHourAgo), id: "list-2" },
    ]);

    await syncPutAwayReminders("household-1");

    expect(shoppingListUpdateManyMock).not.toHaveBeenCalled();
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMembersMock).not.toHaveBeenCalled();
  });

  it("sends nothing when another run already claimed the trip", async () => {
    shoppingListFindManyMock.mockResolvedValue([listWith([{ checkedOffAt: fourHoursAgo, checkedOffByUserId: "user-2" }])]);
    shoppingListUpdateManyMock.mockResolvedValue({ count: 0 });

    await syncPutAwayReminders("household-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMembersMock).not.toHaveBeenCalled();
  });

  it("pushes again but doesn't stack a second bell row while one is still undismissed", async () => {
    shoppingListFindManyMock.mockResolvedValue([listWith([{ checkedOffAt: fourHoursAgo, checkedOffByUserId: "user-2" }])]);
    notificationFindFirstMock.mockResolvedValue({ id: "existing" });

    await syncPutAwayReminders("household-1");

    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(sendPushToHouseholdMembersMock).toHaveBeenCalled();
  });
});

describe("getActiveNotifications — put-away reminder", () => {
  it("maps a PUT_AWAY_REMINDER row to its list", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "notif-7",
        kind: "PUT_AWAY_REMINDER",
        shoppingListId: "list-1",
        inventoryItem: null,
        mealPlanEntry: null,
        shoppingList: { name: "Weekly shop" },
      },
    ]);

    expect(await getActiveNotifications("household-1")).toEqual([
      { id: "notif-7", kind: "putAwayReminder", shoppingListId: "list-1", name: "Weekly shop" },
    ]);
  });
});
