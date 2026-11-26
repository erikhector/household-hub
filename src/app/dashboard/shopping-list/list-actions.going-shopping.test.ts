// GAP-89: announceGoingShoppingAction in
// src/app/dashboard/shopping-list/list-actions.ts — tenancy, the open-list
// check, skipping the sender, wording per recipient locale and the
// per-user-and-list rate limit. Its own file (like item-actions.move.test.ts)
// so it needs only the few mocks it uses. All I/O is mocked; the rate
// limiter is the real in-memory one, reset between tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, shoppingListFindFirstMock, householdMemberFindManyMock, sendPushMock } = vi.hoisted(
  () => ({
    requireHouseholdMock: vi.fn(),
    shoppingListFindFirstMock: vi.fn(),
    householdMemberFindManyMock: vi.fn(),
    sendPushMock: vi.fn(async () => {}),
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingList: { findFirst: shoppingListFindFirstMock },
    householdMember: { findMany: householdMemberFindManyMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/push", () => ({ sendPushToHouseholdMembers: sendPushMock }));
vi.mock("@/lib/i18n/get-dictionary", async () => ({
  getDictionary: vi.fn(async () => (await import("@/lib/i18n/dictionaries/en")).en),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { announceGoingShoppingAction } = await import("@/app/dashboard/shopping-list/list-actions");
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

const member = (id: string, displayName: string, locale = "en") => ({ user: { id, displayName, locale } });

beforeEach(() => {
  _resetRateLimitsForTests();
  requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, userId: "user-1" });
  shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Weekend" });
  householdMemberFindManyMock.mockResolvedValue([
    member("user-1", "Anna"),
    member("user-2", "Erik"),
    member("user-3", "Sara", "sv"),
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("announceGoingShoppingAction (GAP-89)", () => {
  it("looks the list up in the session's household, ACTIVE only", async () => {
    await announceGoingShoppingAction("list-1");

    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "list-1", householdId: "household-1", status: "ACTIVE" } }),
    );
    expect(householdMemberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
  });

  it("refuses a list from another household, or a closed one, and sends nothing", async () => {
    // findFirst scoped by household + ACTIVE finds nothing for either case.
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await announceGoingShoppingAction("someone-elses-or-completed");

    expect(result.error).toBeTruthy();
    expect(result.told).toBeUndefined();
    expect(householdMemberFindManyMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("pushes every other member, never the sender, in their own locale", async () => {
    const result = await announceGoingShoppingAction("list-1");

    expect(result).toEqual({ told: true });
    expect(sendPushMock).toHaveBeenCalledTimes(2);
    expect(sendPushMock).toHaveBeenCalledWith("household-1", ["user-2"], {
      title: "Going shopping",
      body: "Anna is going shopping, add anything you need to Weekend",
      url: "/dashboard/shopping-list/list-1",
    });
    expect(sendPushMock).toHaveBeenCalledWith("household-1", ["user-3"], {
      title: "Ska handla",
      body: "Anna ska handla, lägg till det du behöver på Weekend",
      url: "/dashboard/shopping-list/list-1",
    });
    const pushed = (sendPushMock.mock.calls as unknown as [string, string[]][]).flatMap(([, ids]) => ids);
    expect(pushed).not.toContain("user-1");
  });

  it("says there's no one to tell in a one-member household, without using up the window", async () => {
    householdMemberFindManyMock.mockResolvedValue([member("user-1", "Anna")]);

    expect(await announceGoingShoppingAction("list-1")).toEqual({ told: false });
    expect(sendPushMock).not.toHaveBeenCalled();

    // Someone joins: the first real announcement still goes out.
    householdMemberFindManyMock.mockResolvedValue([member("user-1", "Anna"), member("user-2", "Erik")]);
    expect(await announceGoingShoppingAction("list-1")).toEqual({ told: true });
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });

  it("succeeds but sends nothing on a repeat within 30 minutes, per user and list", async () => {
    vi.useFakeTimers();
    try {
      await announceGoingShoppingAction("list-1");
      expect(sendPushMock).toHaveBeenCalledTimes(2);
      sendPushMock.mockClear();

      // A double tap: same toast, no second buzz.
      expect(await announceGoingShoppingAction("list-1")).toEqual({ told: true });
      expect(sendPushMock).not.toHaveBeenCalled();

      // Another list, or another member, has its own window.
      shoppingListFindFirstMock.mockResolvedValueOnce({ id: "list-2", name: "Party" });
      await announceGoingShoppingAction("list-2");
      expect(sendPushMock).toHaveBeenCalledTimes(2);
      sendPushMock.mockClear();
      requireHouseholdMock.mockResolvedValueOnce({ household: { id: "household-1" }, userId: "user-2" });
      await announceGoingShoppingAction("list-1");
      expect(sendPushMock).toHaveBeenCalledTimes(2);
      sendPushMock.mockClear();

      // Once the window has passed, the same user and list can announce again.
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      await announceGoingShoppingAction("list-1");
      expect(sendPushMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
