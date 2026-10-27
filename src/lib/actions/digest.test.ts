// Tests the weekly digest Server Actions (GAP-27): the Profile opt-in
// toggle (session user only) and the login-free unsubscribe page's action
// (signed token only). Prisma and the session are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { createDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";

const { userUpdateMock, userUpdateManyMock, requireUserIdMock, revalidatePathMock } = vi.hoisted(() => ({
  userUpdateMock: vi.fn(),
  userUpdateManyMock: vi.fn(),
  requireUserIdMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdateMock, updateMany: userUpdateManyMock } } }));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

// Empty by default so errors fall back to English; a test of a translated
// error swaps in `sv` for one call.
const { getDictionaryMock } = vi.hoisted(() => ({ getDictionaryMock: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock, getLocale: vi.fn(async () => "en") }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { setWeeklyDigestEnabledAction, unsubscribeFromDigestAction } = await import("@/lib/actions/digest");

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.AUTH_SECRET = "auth-secret";
  requireUserIdMock.mockResolvedValue("user-1");
  userUpdateMock.mockResolvedValue({});
  userUpdateManyMock.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("setWeeklyDigestEnabledAction", () => {
  it("updates only the signed-in user's preference", async () => {
    expect(await setWeeklyDigestEnabledAction(true)).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { weeklyDigestEnabled: true } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/profile");
  });

  it("can turn it off", async () => {
    await setWeeklyDigestEnabledAction(false);
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { weeklyDigestEnabled: false } });
  });

  it("rejects a non-boolean value", async () => {
    getDictionaryMock.mockResolvedValueOnce(sv);
    const result = await setWeeklyDigestEnabledAction("yes" as unknown as boolean);
    expect(result.error).toBe(sv.errors.invalidInput);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the write fails", async () => {
    userUpdateMock.mockRejectedValue(new Error("db down"));
    const result = await setWeeklyDigestEnabledAction(true);
    expect(result.error).toBe("Something went wrong. Please try again.");
  });
});

describe("unsubscribeFromDigestAction", () => {
  function form(token: string) {
    const fd = new FormData();
    fd.set("token", token);
    return fd;
  }

  it("turns the digest off for a valid token, without a session", async () => {
    const token = createDigestUnsubscribeToken("user-9", "auth-secret");

    expect(await unsubscribeFromDigestAction({}, form(token))).toEqual({ status: "unsubscribed" });
    expect(userUpdateManyMock).toHaveBeenCalledWith({ where: { id: "user-9" }, data: { weeklyDigestEnabled: false } });
    expect(requireUserIdMock).not.toHaveBeenCalled();
  });

  it("reports an invalid token", async () => {
    expect(await unsubscribeFromDigestAction({}, form("user-9.forged"))).toEqual({ status: "invalid" });
    expect(userUpdateManyMock).not.toHaveBeenCalled();
  });

  it("reports an error when the write fails", async () => {
    userUpdateManyMock.mockRejectedValue(new Error("db down"));
    const token = createDigestUnsubscribeToken("user-9", "auth-secret");
    expect(await unsubscribeFromDigestAction({}, form(token))).toEqual({ status: "error" });
  });
});
