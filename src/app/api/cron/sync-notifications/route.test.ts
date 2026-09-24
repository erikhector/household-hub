// Tests the /api/cron/sync-notifications Route Handler. Prisma and the sync
// functions it calls are mocked (same pattern as
// src/app/api/health/route.test.ts) — no real database is touched, and the
// sync functions' own behavior is covered by src/lib/notifications.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { householdFindManyMock, syncMealNotLoggedNotificationsMock, syncExpiringSoonNotificationsMock } = vi.hoisted(
  () => ({
    householdFindManyMock: vi.fn(),
    syncMealNotLoggedNotificationsMock: vi.fn(),
    syncExpiringSoonNotificationsMock: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: { household: { findMany: householdFindManyMock } },
}));

vi.mock("@/lib/notifications", () => ({
  syncMealNotLoggedNotifications: syncMealNotLoggedNotificationsMock,
  syncExpiringSoonNotifications: syncExpiringSoonNotificationsMock,
}));

const { GET } = await import("@/app/api/cron/sync-notifications/route");

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/cron/sync-notifications", { headers });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  householdFindManyMock.mockResolvedValue([{ id: "household-1" }, { id: "household-2" }]);
  syncMealNotLoggedNotificationsMock.mockResolvedValue(undefined);
  syncExpiringSoonNotificationsMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  vi.clearAllMocks();
});

describe("GET /api/cron/sync-notifications", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(householdFindManyMock).not.toHaveBeenCalled();
    expect(syncMealNotLoggedNotificationsMock).not.toHaveBeenCalled();
    expect(syncExpiringSoonNotificationsMock).not.toHaveBeenCalled();
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

  it("runs both sync functions for every household when the bearer token matches", async () => {
    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", householdsSynced: 2 });
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-1");
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledWith("household-2");
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledWith("household-1");
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledWith("household-2");
    expect(syncMealNotLoggedNotificationsMock).toHaveBeenCalledTimes(2);
    expect(syncExpiringSoonNotificationsMock).toHaveBeenCalledTimes(2);
  });

  it("returns 500 with a generic body (no leaked internals) when a sync call throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    syncMealNotLoggedNotificationsMock.mockRejectedValue(new Error("connection refused: secret-host:5432"));

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({ status: "error" });
    expect(bodyText).not.toContain("secret-host");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
