// Tests src/lib/actions/push.ts — in particular that every write is scoped
// to { endpoint, userId } from the session (so one user can never change
// another user's subscription by guessing its endpoint), the quiet-hours
// form action's validation (GAP-14), and subscribeToPushAction's input
// validation and per-user cap (SEC-3). All I/O (Prisma, requireUserId,
// next/cache) is mocked — no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  upsertMock,
  findUniqueMock,
  countMock,
  findFirstMock,
  deleteMock,
  deleteManyMock,
  updateManyMock,
  transactionMock,
  requireUserIdMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  upsertMock: vi.fn<(arg: { create: { timeZone: string | null } }) => Promise<Record<string, never>>>(async () => ({})),
  // Defaults model the common "brand-new endpoint, well under the cap" path:
  // no existing row for this endpoint, and few enough rows that eviction
  // never kicks in. Individual tests override these to exercise the cap.
  // Explicitly typed as returning `{ id: string } | null`/`number` (rather
  // than the narrower type the default implementation alone would infer) so
  // mockResolvedValueOnce can hand back a real row below.
  findUniqueMock: vi.fn<(...args: unknown[]) => Promise<{ id: string } | null>>(async () => null),
  countMock: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0),
  findFirstMock: vi.fn<(...args: unknown[]) => Promise<{ id: string } | null>>(async () => null),
  deleteMock: vi.fn<(...args: unknown[]) => Promise<Record<string, never>>>(async () => ({})),
  deleteManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  requireUserIdMock: vi.fn(async () => "user-1"),
  revalidatePathMock: vi.fn(),
  // subscribeToPushAction runs inside an interactive $transaction so the
  // cap check and the upsert see a consistent row count; the mock just hands
  // the callback a tx whose pushSubscription methods route to the same
  // top-level mocks the tests assert against.
  transactionMock: vi.fn(async (arg: (tx: unknown) => unknown) =>
    arg({
      pushSubscription: {
        findUnique: findUniqueMock,
        count: countMock,
        findFirst: findFirstMock,
        delete: deleteMock,
        upsert: upsertMock,
      },
    }),
  ),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: { deleteMany: deleteManyMock, updateMany: updateManyMock },
    $transaction: transactionMock,
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

// Real Web Push key sizes: a 65-byte uncompressed P-256 point (p256dh) and a
// 16-byte auth secret, both base64url-encoded without padding — 87 and 22
// characters respectively. Any string that decodes to those exact byte
// counts works; these are just one fixed valid pair for readability.
const VALID_P256DH = "aCXZ3ksAu9OwHk5h6W7nR_81aCmuwK8W-2dVrQ3g3GSjawo-e7zWKLwpAvplRraBU_mqH1ZfAVFunlRjNGWoq9I";
const VALID_AUTH = "oVkEBiCMMKemPIX6c1Pm0Q";
const VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const VALID_KEYS = { p256dh: VALID_P256DH, auth: VALID_AUTH };

// The quiet-hours actions below don't validate the endpoint as a real push
// URL (it's just the opaque key they scope writes by), so they keep using a
// plain placeholder — only subscribeToPushAction's schema is SEC-3's target.
const VALID = {
  endpoint: "https://push.example/1",
  quietHoursStart: "22",
  quietHoursEnd: "7",
  timeZone: "Europe/Stockholm",
};

describe("subscribeToPushAction", () => {
  it("stores the browser's time zone on create and update", async () => {
    await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS, timeZone: "Europe/Stockholm" });

    expect(upsertMock).toHaveBeenCalledWith({
      where: { endpoint: VALID_ENDPOINT },
      create: { userId: "user-1", endpoint: VALID_ENDPOINT, p256dh: VALID_P256DH, auth: VALID_AUTH, timeZone: "Europe/Stockholm" },
      update: { userId: "user-1", p256dh: VALID_P256DH, auth: VALID_AUTH, timeZone: "Europe/Stockholm" },
    });
  });

  it("stores null for a missing or unrecognised time zone instead of failing", async () => {
    await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS, timeZone: "Not/AZone" });
    await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS });

    expect(upsertMock.mock.calls[0][0].create.timeZone).toBeNull();
    expect(upsertMock.mock.calls[1][0].create.timeZone).toBeNull();
  });

  describe("endpoint validation (SEC-3)", () => {
    it.each([
      ["a plain http URL", "http://fcm.googleapis.com/fcm/send/abc"],
      ["a host outside the allowlist", "https://internal.example.com/hook"],
      ["not a URL at all", "not-a-url"],
      // Substring/prefix tricks that must not slip past a naive `includes`
      // or `startsWith` check against the allowlist.
      ["a host with the allowed name as a prefix", "https://fcm.googleapis.com.evil.example/x"],
      ["a host with the allowed name glued on without a dot", "https://evilfcm.googleapis.com/x"],
      ["an endpoint over 1024 characters", `https://fcm.googleapis.com/fcm/send/${"a".repeat(1100)}`],
    ])("rejects %s", async (_label, endpoint) => {
      await expect(subscribeToPushAction({ endpoint, keys: VALID_KEYS })).rejects.toThrow();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it.each([
      ["Chrome/Edge (FCM)", "https://fcm.googleapis.com/fcm/send/abc123"],
      ["Firefox (a subdomain of the Mozilla push service)", "https://updates.push.services.mozilla.com/wpush/v2/abc"],
      ["legacy Edge/WNS", "https://bn1.notify.windows.com/w/abc"],
      ["Safari web push", "https://web.push.apple.com/abc"],
    ])("accepts a real %s endpoint", async (_label, endpoint) => {
      await expect(subscribeToPushAction({ endpoint, keys: VALID_KEYS })).resolves.toBeUndefined();
      expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ where: { endpoint } }));
    });
  });

  describe("key validation (SEC-3)", () => {
    it.each([
      ["a p256dh that's too short", { p256dh: "short", auth: VALID_AUTH }],
      ["a p256dh with invalid base64url characters", { p256dh: VALID_P256DH.slice(0, -1) + "!", auth: VALID_AUTH }],
      ["an auth secret that's too short", { p256dh: VALID_P256DH, auth: "short" }],
      ["an auth secret that's too long", { p256dh: VALID_P256DH, auth: VALID_AUTH + VALID_AUTH }],
    ])("rejects %s", async (_label, keys) => {
      await expect(subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys })).rejects.toThrow();
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("tolerates padded base64url keys, since some browsers still send them", async () => {
      // 22 unpadded chars -> 24 padded (two trailing '='); still 16 bytes.
      const paddedAuth = `${VALID_AUTH}==`;

      await expect(subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: { p256dh: VALID_P256DH, auth: paddedAuth } })).resolves.toBeUndefined();
    });
  });

  describe("per-user cap (SEC-3)", () => {
    it("evicts the oldest subscription when a new endpoint would exceed the cap", async () => {
      findUniqueMock.mockResolvedValueOnce(null); // this endpoint doesn't exist yet -> a new row
      countMock.mockResolvedValueOnce(10); // already at the cap
      findFirstMock.mockResolvedValueOnce({ id: "oldest-sub" });

      await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS });

      expect(countMock).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(findFirstMock).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      expect(deleteMock).toHaveBeenCalledWith({ where: { id: "oldest-sub" } });
      expect(upsertMock).toHaveBeenCalled();
    });

    it("doesn't evict when under the cap", async () => {
      countMock.mockResolvedValueOnce(9);

      await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS });

      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("never evicts when the subscribe is just an update to an existing endpoint", async () => {
      findUniqueMock.mockResolvedValueOnce({ id: "existing-sub" });

      await subscribeToPushAction({ endpoint: VALID_ENDPOINT, keys: VALID_KEYS });

      // Re-subscribing an already-stored endpoint doesn't grow the count, so
      // it must never trigger the count check or an eviction.
      expect(countMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
      expect(upsertMock).toHaveBeenCalled();
    });
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
