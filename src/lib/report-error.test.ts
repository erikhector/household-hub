import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { reportError } from "@/lib/report-error";

describe("reportError", () => {
  beforeEach(() => {
    captureException.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs a redacted line and captures the error, tagged with the household", () => {
    const error = Object.assign(new Error("boom"), { apiToken: "secret-value" });
    reportError("Sync failed", error, { householdId: "h1" });

    const line = String(vi.mocked(console.error).mock.calls[0][0]);
    expect(line).toContain("Sync failed");
    expect(line).toContain("h1");
    expect(line).not.toContain("secret-value");
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: { householdId: "h1" } }),
    );
  });

  it("omits the tag when there is no household", () => {
    reportError("Health check failed", new Error("x"));
    expect(captureException.mock.calls[0][1]).not.toHaveProperty("tags");
  });
});
