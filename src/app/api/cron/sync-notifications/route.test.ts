// Tests the /api/cron/sync-notifications Route Handler. Prisma and the sync
// functions it calls are mocked (same pattern as
// src/app/api/health/route.test.ts) — no real database is touched, and the
// sync functions' own behavior is covered by src/lib/notifications.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  householdFindManyMock,
  syncMealNotLoggedNotificationsMock,
  syncExpiringSoonNotificationsMock,
  syncPutAwayRemindersMock,
} = vi.hoisted(() => ({
  householdFindManyMock: vi.fn(),
  syncMealNotLoggedNotificationsMock: vi.fn(),
  syncExpiringSoonNotificationsMock: vi.fn(),
  syncPutAwayRemindersMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { household: { findMany: householdFindManyMock } },
}));

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

vi.mock("@/lib/notifications", () => ({
  syncMealNotLoggedNotifications: syncMealNotLoggedNotificationsMock,
  syncExpiringSoonNotifications: syncExpiringSoonNotificationsMock,
  syncPutAwayReminders: syncPutAwayRemindersMock,
}));

const { GET } = await import("@/app/api/cron/sync-notifications/route");

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/cron/sync-notifications", { headers });
}

function households(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `household-${i + 1}` }));
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  householdFindManyMock.mockResolvedValue(households(2));
  syncMealNotLoggedNotificationsMock.mockResolvedValue(undefined);
  syncExpiringSoonNotificationsMock.mockResolvedValue(undefined);
  syncPutAwayRemindersMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  vi.clearAllMocks();
});

describe("GET /api/cron/sync-notifications", () => {
  it("rejects a request with no Authorization header", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(householdFindManyMock).not.toHaveBeenCalled();
    expect(syncMealNotLoggedNotificationsMock).not.toHaveBeenCalled();
    expect(syncExpiringSoonNotificationsMock).not.toHaveBeenCalled();
    // A rejected run must be noticeable in logs, not just a silent 401 —
    // an unset/wrong CRON_SECRET in production means every notification
    // sync silently stops, so this is worth a loud server-side signal.
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(householdFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects even a correct-looking token when CRON_SECRET isn't configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request("Bearer undefined"));

    expect(response.status).toBe(401);
    expect(householdFindManyMock).not.toHaveBeenCalled();
  });

  it("runs every sync function for every household when the bearer token matches", async () => {
    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", householdsSynced: 2, householdsFailed: 0, failedHouseholdIds: [] });
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-1");
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-2");
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledWith("household-1");
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledWith("household-2");
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledTimes(2);
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledTimes(2);
    expect(syncPutAwayRemindersMock).toHaveBeenCalledWith("household-1");
    expect(syncPutAwayRemindersMock).toHaveBeenCalledWith("household-2");
  });

  it("counts a household as failed when only its put-away reminder sync fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncPutAwayRemindersMock.mockImplementation(async (id: string) => {
      if (id === "household-2") throw new Error("boom");
    });

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(body).toEqual({
      status: "partial_failure",
      householdsSynced: 1,
      householdsFailed: 1,
      failedHouseholdIds: ["household-2"],
    });
    // The other two syncs still ran for the failing household.
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledWith("household-2");
    consoleErrorSpy.mockRestore();
  });

  it("processes households in batches capped at 10 concurrent", async () => {
    householdFindManyMock.mockResolvedValue(households(25));
    let concurrent = 0;
    let maxConcurrent = 0;
    syncMealNotLoggedNotificationsMock.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
    });

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", householdsSynced: 25, householdsFailed: 0, failedHouseholdIds: [] });
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledTimes(25);
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it("does not fail the whole run when one household's sync throws — the rest still succeed", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    householdFindManyMock.mockResolvedValue(households(3));
    syncMealNotLoggedNotificationsMock.mockImplementation(async (householdId: string) => {
      if (householdId === "household-2") throw new Error("boom");
    });

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "partial_failure",
      householdsSynced: 2,
      householdsFailed: 1,
      failedHouseholdIds: ["household-2"],
    });
    // The other households' sync calls still happened — one household's
    // rejection didn't abort its batch.
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-1");
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-3");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("returns 500 with a generic body (no leaked internals) when the household lookup itself fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    householdFindManyMock.mockRejectedValue(new Error("connection refused: secret-host:5432"));

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({ status: "error" });
    expect(bodyText).not.toContain("secret-host");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("waits for a failing household's other sync to finish before responding", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    householdFindManyMock.mockResolvedValue(households(1));
    syncMealNotLoggedNotificationsMock.mockRejectedValue(new Error("boom"));
    let expiringSyncFinished = false;
    syncExpiringSoonNotificationsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expiringSyncFinished = true;
    });

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    // The meal sync rejected immediately, but the route must not respond
    // (and let the invocation be frozen) while the same household's
    // expiring-soon sync — and the push sends it awaits — is still running.
    expect(expiringSyncFinished).toBe(true);
    expect(body).toEqual({
      status: "partial_failure",
      householdsSynced: 0,
      householdsFailed: 1,
      failedHouseholdIds: ["household-1"],
    });

    consoleErrorSpy.mockRestore();
  });

  it("counts a household once, and logs each error, when both of its syncs fail", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncMealNotLoggedNotificationsMock.mockImplementation(async (householdId: string) => {
      if (householdId === "household-1") throw new Error("meal sync failed");
    });
    syncExpiringSoonNotificationsMock.mockImplementation(async (householdId: string) => {
      if (householdId === "household-1") throw new Error("expiry sync failed");
    });

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(body).toEqual({
      status: "partial_failure",
      householdsSynced: 1,
      householdsFailed: 1,
      failedHouseholdIds: ["household-1"],
    });
    // Each per-household failure reaches Sentry tagged with that household.
    for (const message of ["meal sync failed", "expiry sync failed"]) {
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message }),
        expect.objectContaining({ tags: { householdId: "household-1" } }),
      );
    }

    consoleErrorSpy.mockRestore();
  });
});
