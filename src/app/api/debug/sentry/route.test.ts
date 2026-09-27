// Tests the temporary /api/debug/sentry Route Handler. Auth is mocked (same
// pattern as src/app/session-expired/route.test.ts); Sentry itself isn't
// involved here -- the route only has to throw, and reporting is
// src/instrumentation.ts's job.
import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));

const { GET } = await import("@/app/api/debug/sentry/route");

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/debug/sentry", () => {
  it("returns 401 without throwing when nobody is signed in", async () => {
    authMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("throws an unhandled error for a signed-in user so onRequestError reports it", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });

    await expect(GET()).rejects.toThrow("Squirrel Sentry pipeline test");
  });
});
