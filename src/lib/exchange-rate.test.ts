// Mirrors the fetch-mocking convention from src/lib/actions/barcode.test.ts
// (vi.stubGlobal("fetch", ...)) since fetchExchangeRate is the other module
// in this codebase that calls a live external API.
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchExchangeRate } from "@/lib/exchange-rate";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

describe("fetchExchangeRate", () => {
  it("returns the converted rate from a successful API response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rates: { USD: 1.23 } }));

    const rate = await fetchExchangeRate("SEK", "USD");

    expect(rate).toBe(1.23);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("from=SEK");
    expect(url).toContain("to=USD");
  });

  it("returns null on a non-OK HTTP response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rates: { USD: 1.23 } }, false));

    const rate = await fetchExchangeRate("SEK", "USD");

    expect(rate).toBeNull();
  });

  it("returns null when the response body isn't valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    const rate = await fetchExchangeRate("SEK", "USD");

    expect(rate).toBeNull();
  });

  it("returns null when the requested currency is missing from the response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rates: { EUR: 0.09 } }));

    const rate = await fetchExchangeRate("SEK", "USD");

    expect(rate).toBeNull();
  });

  it("short-circuits to 1 for the same currency without calling the network", async () => {
    const rate = await fetchExchangeRate("sek", "SEK");

    expect(rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when fetch rejects (offline or timeout)", async () => {
    fetchMock.mockRejectedValue(new Error("network error"));

    const rate = await fetchExchangeRate("SEK", "USD");

    expect(rate).toBeNull();
  });
});
