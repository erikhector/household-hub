// Tests the /api/cron/weekly-digest Route Handler's own gatekeeping: the
// CRON_SECRET check (same contract as /api/cron/sync-notifications), the
// no-op when email isn't configured, and how it reports runWeeklyDigest's
// result. The digest logic itself is covered by src/lib/weekly-digest.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runWeeklyDigestMock, isEmailConfiguredMock } = vi.hoisted(() => ({
  runWeeklyDigestMock: vi.fn(),
  isEmailConfiguredMock: vi.fn(),
}));

vi.mock("@/lib/weekly-digest", () => ({ runWeeklyDigest: runWeeklyDigestMock }));
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

vi.mock("@/lib/email", () => ({ isEmailConfigured: isEmailConfiguredMock }));

const { GET } = await import("@/app/api/cron/weekly-digest/route");

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://squirrel.example.com/api/cron/weekly-digest", { headers });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.AUTH_SECRET = "auth-secret";
  delete process.env.APP_URL;
  isEmailConfiguredMock.mockReturnValue(true);
  runWeeklyDigestMock.mockResolvedValue({
    householdsProcessed: 2,
    emailsSent: 3,
    emailsFailed: 0,
    failedHouseholdIds: [],
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe("GET /api/cron/weekly-digest", () => {
  it("rejects a request without the bearer token", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runWeeklyDigestMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("rejects the wrong token, and any token when CRON_SECRET is unset", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(request("Bearer undefined"))).status).toBe(401);
    expect(runWeeklyDigestMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("is a successful no-op when email isn't configured", async () => {
    isEmailConfiguredMock.mockReturnValue(false);

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "skipped", reason: "email_not_configured" });
    expect(runWeeklyDigestMock).not.toHaveBeenCalled();
  });

  it("sends nothing when there's no AUTH_SECRET to sign unsubscribe links with", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.AUTH_SECRET;

    const response = await GET(request("Bearer test-secret"));

    expect(await response.json()).toEqual({ status: "skipped", reason: "auth_secret_missing" });
    expect(runWeeklyDigestMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("runs the digest with the request origin when APP_URL isn't set", async () => {
    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      householdsProcessed: 2,
      emailsSent: 3,
      emailsFailed: 0,
      failedHouseholdIds: [],
    });
    expect(runWeeklyDigestMock).toHaveBeenCalledWith({
      now: expect.any(Date),
      appUrl: "https://squirrel.example.com",
      secret: "auth-secret",
    });
  });

  it("prefers APP_URL (trailing slash trimmed)", async () => {
    process.env.APP_URL = "https://app.example.com/";

    await GET(request("Bearer test-secret"));

    expect(runWeeklyDigestMock).toHaveBeenCalledWith(expect.objectContaining({ appUrl: "https://app.example.com" }));
  });

  it("reports a partial failure", async () => {
    runWeeklyDigestMock.mockResolvedValue({
      householdsProcessed: 1,
      emailsSent: 1,
      emailsFailed: 1,
      failedHouseholdIds: ["h1"],
    });

    const body = await (await GET(request("Bearer test-secret"))).json();

    expect(body.status).toBe("partial_failure");
    expect(body.failedHouseholdIds).toEqual(["h1"]);
  });

  it("returns a generic 500 when the run itself fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runWeeklyDigestMock.mockRejectedValue(new Error("connection refused: secret-host:5432"));

    const response = await GET(request("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ status: "error" });
    expect(JSON.stringify(body)).not.toContain("secret-host");
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("secret-host") }), expect.anything());
    consoleErrorSpy.mockRestore();
  });
});
