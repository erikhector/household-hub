// Tests the /api/health Route Handler. Prisma is mocked (same pattern as
// src/lib/actions/household.test.ts) — no real database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
}));

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: queryRawMock },
}));

const { GET } = await import("@/app/api/health/route");

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 with status ok when the DB round-trip succeeds", async () => {
    queryRawMock.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with a generic error body (no leaked internals) when the DB is unreachable", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryRawMock.mockRejectedValue(new Error("connection refused: secret-host:5432"));

    const response = await GET();
    const body = await response.json();
    const bodyText = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error" });
    expect(bodyText).not.toContain("secret-host");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("connection refused") }), expect.anything());

    consoleErrorSpy.mockRestore();
  });
});
