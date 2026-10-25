// Tests the tonight's-dinner nudge opt-in (GAP-57): session user only,
// boolean only. Prisma and the session are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userUpdateMock, requireUserIdMock, revalidatePathMock } = vi.hoisted(() => ({
  userUpdateMock: vi.fn(),
  requireUserIdMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: userUpdateMock } } }));
vi.mock("@/lib/session", () => ({ requireUserId: requireUserIdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { setTonightsDinnerNudgeAction } = await import("@/lib/actions/notification-preferences");

beforeEach(() => {
  requireUserIdMock.mockResolvedValue("user-1");
  userUpdateMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("setTonightsDinnerNudgeAction", () => {
  it("updates only the signed-in user's preference", async () => {
    expect(await setTonightsDinnerNudgeAction(true)).toEqual({});
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { tonightsDinnerNudge: true } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/profile");
  });

  it("can turn it off", async () => {
    await setTonightsDinnerNudgeAction(false);
    expect(userUpdateMock).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { tonightsDinnerNudge: false } });
  });

  it("rejects a non-boolean value", async () => {
    const result = await setTonightsDinnerNudgeAction("yes" as unknown as boolean);
    expect(result.error).toBeDefined();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the write fails", async () => {
    userUpdateMock.mockRejectedValue(new Error("db down"));
    const result = await setTonightsDinnerNudgeAction(true);
    expect(result.error).toBe("Something went wrong. Please try again.");
  });
});
