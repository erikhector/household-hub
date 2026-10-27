// Sentry 11 collects personal data unless told not to (see
// sentry-data-collection.ts). These pin the opt-outs, and that the server's
// Sentry.init() actually passes them.
import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init, captureRequestError: vi.fn() }));

import { SENTRY_DATA_COLLECTION } from "./sentry-data-collection";
import { register } from "@/instrumentation";

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects no user info, cookies, bodies, local variables or query data", () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    });
  });

  it("filters IP and identity headers out of requests, responses and query strings", () => {
    for (const filter of [
      SENTRY_DATA_COLLECTION.httpHeaders.request,
      SENTRY_DATA_COLLECTION.httpHeaders.response,
      SENTRY_DATA_COLLECTION.urlQueryParams,
    ]) {
      expect(filter.deny).toEqual(expect.arrayContaining(["forwarded", "-ip", "remote-", "via", "-user"]));
    }
  });
});

describe("register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    init.mockClear();
  });

  it("passes the data-collection opt-outs to Sentry.init", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@example.ingest.sentry.io/1");
    await register();
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dataCollection: SENTRY_DATA_COLLECTION }));
  });

  it("doesn't initialize Sentry without a DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    await register();
    expect(init).not.toHaveBeenCalled();
  });
});
