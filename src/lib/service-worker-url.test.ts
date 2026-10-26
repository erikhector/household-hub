import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceWorkerUrl } from "./service-worker-url";

describe("serviceWorkerUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("flags production builds so the worker caches hashed static assets", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(serviceWorkerUrl().searchParams.get("prod")).toBe("1");
  });

  it("leaves the flag off in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(serviceWorkerUrl().searchParams.has("prod")).toBe(false);
  });
});
