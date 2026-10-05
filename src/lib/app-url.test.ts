import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));

import { absoluteAppUrl, configuredAppUrl } from "@/lib/app-url";

describe("absoluteAppUrl", () => {
  const original = process.env.APP_URL;

  beforeEach(() => {
    headersMock.mockReset();
    delete process.env.APP_URL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  });

  it("prefers APP_URL (trailing slashes stripped) over a spoofable Host header", async () => {
    process.env.APP_URL = " https://squirrel.example/// ";
    headersMock.mockResolvedValue(new Headers({ host: "evil.example" }));
    expect(await absoluteAppUrl("/join/abc")).toBe("https://squirrel.example/join/abc");
    expect(headersMock).not.toHaveBeenCalled();
  });

  it("falls back to the Host header, http for localhost and https otherwise", async () => {
    headersMock.mockResolvedValueOnce(new Headers({ host: "localhost:3000" }));
    expect(await absoluteAppUrl("/x")).toBe("http://localhost:3000/x");
    headersMock.mockResolvedValueOnce(new Headers({ host: "app.example" }));
    expect(await absoluteAppUrl("/x")).toBe("https://app.example/x");
  });

  it("defaults to localhost:3000 with no Host header", async () => {
    headersMock.mockResolvedValue(new Headers());
    expect(await absoluteAppUrl("/x")).toBe("http://localhost:3000/x");
  });
});

describe("configuredAppUrl", () => {
  afterEach(() => {
    delete process.env.APP_URL;
  });

  it("is undefined when APP_URL is unset or blank", () => {
    delete process.env.APP_URL;
    expect(configuredAppUrl()).toBeUndefined();
    process.env.APP_URL = "   ";
    expect(configuredAppUrl()).toBeUndefined();
  });
});
