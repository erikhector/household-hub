// Tests sendPushToHousehold() (src/lib/push.ts). VAPID configuration is
// read from process.env at module load time, so each case resets modules
// and re-imports after setting/clearing env vars rather than importing once
// at the top of the file (the pattern most other tests here use).
import { afterEach, describe, expect, it, vi } from "vitest";

const { findManyMock, deleteMock, sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  deleteMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: { findMany: findManyMock, delete: deleteMock },
  },
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: setVapidDetailsMock, sendNotification: sendNotificationMock },
}));

const ORIGINAL_ENV = { ...process.env };

async function loadPush() {
  vi.resetModules();
  return import("@/lib/push");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("sendPushToHousehold", () => {
  it("is a no-op when VAPID keys aren't configured", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { sendPushToHousehold } = await loadPush();

    await sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("does nothing when the household has no subscriptions", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([]);
    const { sendPushToHousehold } = await loadPush();

    await sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("sends to every subscription belonging to the household's members", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([{ id: "sub-1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1" }]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToHousehold } = await loadPush();

    await sendPushToHousehold("household-1", { title: "Out of stock", body: "Eggs is out of stock", url: "/dashboard/inventory?status=out" });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { user: { memberships: { some: { householdId: "household-1" } } } },
    });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      { endpoint: "https://push.example/1", keys: { p256dh: "p1", auth: "a1" } },
      JSON.stringify({ title: "Out of stock", body: "Eggs is out of stock", url: "/dashboard/inventory?status=out" }),
      { timeout: 10_000 },
    );
  });

  it("excludes the acting user's own subscriptions when excludeUserId is given", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([{ id: "sub-1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1" }]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToHousehold } = await loadPush();

    await sendPushToHousehold(
      "household-1",
      { title: "Out of stock", body: "Eggs is out of stock", url: "/dashboard/inventory?status=out" },
      "user-1",
    );

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        user: { memberships: { some: { householdId: "household-1" } } },
        userId: { not: "user-1" },
      },
    });
  });

  it("deletes a subscription the push service reports as gone (410) and doesn't throw", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([{ id: "sub-1", endpoint: "e", p256dh: "p", auth: "a" }]);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    deleteMock.mockResolvedValue({});
    const { sendPushToHousehold } = await loadPush();

    await expect(sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" })).resolves.toBeUndefined();

    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "sub-1" } });
  });

  it("swallows a non-expiry send error instead of throwing", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([{ id: "sub-1", endpoint: "e", p256dh: "p", auth: "a" }]);
    sendNotificationMock.mockRejectedValue(new Error("network blip"));
    const { sendPushToHousehold } = await loadPush();

    await expect(sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" })).resolves.toBeUndefined();

    expect(deleteMock).not.toHaveBeenCalled();
  });

  describe("quiet hours (GAP-14)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // 23:00 in Stockholm (UTC+1 in January), 17:00 in New York.
    const NOW = new Date("2026-01-15T22:00:00Z");

    it("skips a subscription whose quiet window covers its own local hour, and sends to the rest", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      findManyMock.mockResolvedValue([
        // Quiet 22 → 7 Stockholm time, and it's 23:00 there: skipped.
        { id: "sub-1", endpoint: "e1", p256dh: "p1", auth: "a1", quietHoursStart: 22, quietHoursEnd: 7, timeZone: "Europe/Stockholm" },
        // Same window, but it's 17:00 in New York: sent.
        { id: "sub-2", endpoint: "e2", p256dh: "p2", auth: "a2", quietHoursStart: 22, quietHoursEnd: 7, timeZone: "America/New_York" },
        // No quiet hours: sent.
        { id: "sub-3", endpoint: "e3", p256dh: "p3", auth: "a3", quietHoursStart: null, quietHoursEnd: null, timeZone: null },
      ]);
      sendNotificationMock.mockResolvedValue(undefined);
      const { sendPushToHousehold } = await loadPush();

      await sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" });

      const endpoints = sendNotificationMock.mock.calls.map(([sub]) => sub.endpoint);
      expect(endpoints).toEqual(["e2", "e3"]);
    });

    it("still sends when quiet hours are set but the stored time zone is missing", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      findManyMock.mockResolvedValue([
        { id: "sub-1", endpoint: "e1", p256dh: "p1", auth: "a1", quietHoursStart: 0, quietHoursEnd: 23, timeZone: null },
      ]);
      sendNotificationMock.mockResolvedValue(undefined);
      const { sendPushToHousehold } = await loadPush();

      await sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" });

      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("sends nothing when every subscription is in quiet hours", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
      process.env.VAPID_PRIVATE_KEY = "priv";
      vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
      findManyMock.mockResolvedValue([
        { id: "sub-1", endpoint: "e1", p256dh: "p1", auth: "a1", quietHoursStart: 22, quietHoursEnd: 7, timeZone: "Europe/Stockholm" },
      ]);
      const { sendPushToHousehold } = await loadPush();

      await sendPushToHousehold("household-1", { title: "t", body: "b", url: "/dashboard" });

      expect(sendNotificationMock).not.toHaveBeenCalled();
    });
  });
});

describe("sendPushToHouseholdMembers", () => {
  it("sends only to the named users, and only while they're still members of the household", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    findManyMock.mockResolvedValue([{ id: "sub-1", endpoint: "https://push.example/1", p256dh: "p1", auth: "a1" }]);
    sendNotificationMock.mockResolvedValue(undefined);
    const { sendPushToHouseholdMembers } = await loadPush();

    await sendPushToHouseholdMembers("household-1", ["user-2"], { title: "t", body: "b", url: "/dashboard" });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { userId: { in: ["user-2"] }, user: { memberships: { some: { householdId: "household-1" } } } },
    });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty recipient list", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const { sendPushToHouseholdMembers } = await loadPush();

    await sendPushToHouseholdMembers("household-1", [], { title: "t", body: "b", url: "/dashboard" });

    expect(findManyMock).not.toHaveBeenCalled();
  });
});
