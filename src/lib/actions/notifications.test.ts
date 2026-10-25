// Tests src/lib/actions/notifications.ts: every write is scoped to the
// household from the session (never a client-supplied id), so another
// household's notification id can't be dismissed. Prisma and session are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateManyMock, requireHouseholdMock, revalidatePathMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn(),
  requireHouseholdMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { notification: { updateMany: updateManyMock } } }));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { dismissAllNotificationsAction, dismissNotificationAction } from "./notifications";

describe("notification actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireHouseholdMock.mockResolvedValue({ household: { id: "hh-1" } });
    updateManyMock.mockResolvedValue({ count: 0 });
  });

  it("dismisses one notification scoped to the session's household and still-active rows", async () => {
    await dismissNotificationAction("n-1");
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const arg = updateManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "n-1", householdId: "hh-1", dismissedAt: null });
    expect(arg.data.dismissedAt).toBeInstanceOf(Date);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  // The id is another household's: the where clause carries OUR household id,
  // so the DB matches nothing, and the action resolves without throwing.
  it("treats another household's id as a silent no-op", async () => {
    await expect(dismissNotificationAction("other-household-note")).resolves.toBeUndefined();
    expect(updateManyMock.mock.calls[0][0].where.householdId).toBe("hh-1");
  });

  it("dismisses all active notifications for the session's household only", async () => {
    await dismissAllNotificationsAction();
    const arg = updateManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ householdId: "hh-1", dismissedAt: null });
    expect(arg.data.dismissedAt).toBeInstanceOf(Date);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/notifications");
  });

  it("does not touch the database when there is no household (requireHousehold throws)", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(dismissNotificationAction("n-1")).rejects.toThrow("NEXT_REDIRECT");
    await expect(dismissAllNotificationsAction()).rejects.toThrow("NEXT_REDIRECT");
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
