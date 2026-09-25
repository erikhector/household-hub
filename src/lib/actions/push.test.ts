// Tests src/lib/actions/push.ts — in particular that every write is scoped
// to { endpoint, userId } from the session (so one user can never change
// another user's subscription by guessing its endpoint), and the quiet-hours
// form action's validation (GAP-14). All I/O (Prisma, requireUserId,
// next/cache) is mocked — no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const { upsertMock, deleteManyMock, updateManyMock, requireUserIdMock, revalidatePathMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  requireUserIdMock: vi.fn(async () => "user-1"),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: { upsert: upsertMock, deleteMany: deleteManyMock, updateMany: updateManyMock },
  },
}));

vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  clearPushQuietHoursAction,
  setPushQuietHoursAction,
  subscribeToPushAction,
  unsubscribeFromPushAction,
} from "@/lib/actions/push";

afterEach(() => {
  vi.clearAllMocks();
});

function quietHoursForm(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

const VALID = {
  endpoint: "https://push.example/1",
  quietHoursStart: "22",
  quietHoursEnd: "7",
  timeZone: "Europe/Stockholm",
};

describe("subscribeToPushAction", () => {
  it("stores the browser's time zone on create and update", async () => {
    await subscribeToPushAction({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
      timeZone: "Europe/Stockholm",
    });

    expect(upsertMock).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/1" },
      create: { userId: "user-1", endpoint: "https://push.example/1", p256dh: "p", auth: "a", timeZone: "Europe/Stockholm" },
      update: { userId: "user-1", p256dh: "p", auth: "a", timeZone: "Europe/Stockholm" },
    });
  });

  it("stores null for a missing or unrecognised time zone instead of failing", async () => {
    await subscribeToPushAction({ endpoint: "e", keys: { p256dh: "p", auth: "a" }, timeZone: "Not/AZone" });
    await subscribeToPushAction({ endpoint: "e", keys: { p256dh: "p", auth: "a" } });

    expect(upsertMock.mock.calls[0][0].create.timeZone).toBeNull();
    expect(upsertMock.mock.calls[1][0].create.timeZone).toBeNull();
  });
});

describe("unsubscribeFromPushAction", () => {
  it("deletes only the caller's own subscription for that endpoint", async () => {
    await unsubscribeFromPushAction("https://push.example/1");

    expect(deleteManyMock).toHaveBeenCalledWith({ where: { endpoint: "https://push.example/1", userId: "user-1" } });
  });
});

describe("setPushQuietHoursAction", () => {
  it("saves the window and zone, scoped to the caller's own endpoint", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    const result = await setPushQuietHoursAction({}, quietHoursForm(VALID));

    expect(result).toEqual({});
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/1", userId: "user-1" },
      data: { quietHoursStart: 22, quietHoursEnd: 7, timeZone: "Europe/Stockholm" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/profile");
  });

  it("returns an error when the endpoint isn't one of the caller's subscriptions", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });

    const result = await setPushQuietHoursAction({}, quietHoursForm({ ...VALID, endpoint: "https://push.example/someone-else" }));

    expect(result.error).toBeDefined();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an out-of-range start hour", { quietHoursStart: "24" }],
    ["a negative end hour", { quietHoursEnd: "-1" }],
    ["a fractional hour", { quietHoursStart: "7.5" }],
    ["a non-numeric hour", { quietHoursEnd: "late" }],
    ["an empty hour (which must not coerce to midnight)", { quietHoursStart: "" }],
    ["an unrecognised time zone", { timeZone: "Not/AZone" }],
    ["an empty endpoint", { endpoint: "" }],
    ["equal start and end hours", { quietHoursStart: "8", quietHoursEnd: "8" }],
  ])("rejects %s without writing", async (_label, override) => {
    const result = await setPushQuietHoursAction({}, quietHoursForm({ ...VALID, ...override }));

    expect(result.error).toBeDefined();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("rejects a form with a missing hour field", async () => {
    const formData = quietHoursForm(VALID);
    formData.delete("quietHoursEnd");

    const result = await setPushQuietHoursAction({}, formData);

    expect(result.error).toBeDefined();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("accepts midnight as a boundary", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    const result = await setPushQuietHoursAction({}, quietHoursForm({ ...VALID, quietHoursStart: "0", quietHoursEnd: "6" }));

    expect(result).toEqual({});
    expect(updateManyMock.mock.calls[0][0].data).toMatchObject({ quietHoursStart: 0, quietHoursEnd: 6 });
  });
});

describe("clearPushQuietHoursAction", () => {
  it("clears both hours on the caller's own subscription only", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    await clearPushQuietHoursAction("https://push.example/1");

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { endpoint: "https://push.example/1", userId: "user-1" },
      data: { quietHoursStart: null, quietHoursEnd: null },
    });
  });
});
