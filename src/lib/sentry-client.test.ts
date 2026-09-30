import { afterEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { captureClientException } from "./sentry-client";

describe("captureClientException", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    captureException.mockClear();
  });

  it("does nothing without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    await captureClientException(new Error("boom"));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("forwards the error to Sentry when a DSN is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@example.ingest.sentry.io/1");
    const error = new Error("boom");
    await captureClientException(error);
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
