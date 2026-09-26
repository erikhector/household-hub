// SEC-2: recipe-import.test.ts fakes node:http/https so it can exercise
// fetchRecipeHtml's SSRF/DNS-rebinding guard without a real connection, but
// a fake can only prove it satisfies whatever contract *it* was coded to
// expect — not Node's actual one. (The first version of createPinnedPublicLookup
// passed every test in that file while breaking every real request with
// ERR_INVALID_IP_ADDRESS, because Node's `autoSelectFamily` always calls
// `lookup` with `{ all: true }` and the fake didn't know that either.) This
// file is deliberately separate and does NOT mock node:http/node:https, so
// fetchRecipeHtml runs its real `http.request` call, with the real `lookup`
// contract, against a real `http.createServer` on loopback.
//
// The only thing mocked here is node:dns (so a made-up hostname can resolve
// to the local test server) and, for the "goes through end-to-end" case
// only, recipe-import.ts's private-address check via its test-only
// `_setPrivateAddressCheckForTests` seam — loopback genuinely is private,
// so proving a real request can succeed at all means telling the guard to
// treat this one test's resolved address as public, same as a real public
// address would be. The refusal case below needs no such override: it
// asserts the *real*, unmodified guard on a *real* connection attempt.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({ promises: { lookup: lookupMock } }));

const { fetchRecipeHtml, _setPrivateAddressCheckForTests } = await import("@/lib/recipe-import");

let server: http.Server;
let serverAddress: string;
let serverPort: number;
let requestCount = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    requestCount += 1;
    res.end("<html><body>hello from a real server</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a real AddressInfo");
  serverAddress = address.address;
  serverPort = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  lookupMock.mockReset();
  requestCount = 0;
  _setPrivateAddressCheckForTests(null);
});

describe("fetchRecipeHtml against a real http.createServer (SEC-2)", () => {
  it("connects and reads the body through the real Node lookup contract", async () => {
    lookupMock.mockResolvedValue([{ address: serverAddress, family: 4 }]);
    // Loopback is genuinely private; this test's whole point is exercising
    // a real connection, so treat this one resolved address as public —
    // see the file header comment.
    _setPrivateAddressCheckForTests(() => false);

    const result = await fetchRecipeHtml(`http://pinned-lookup-test.invalid:${serverPort}/`);

    expect(result).toEqual({ ok: true, html: "<html><body>hello from a real server</body></html>" });
    expect(requestCount).toBe(1);
  });

  it("refuses a hostname that resolves to a private address, and never sends the request", async () => {
    lookupMock.mockResolvedValue([{ address: serverAddress, family: 4 }]); // 127.0.0.1 — genuinely private
    // No override here: this is the real, unmodified guard.

    const result = await fetchRecipeHtml(`http://pinned-lookup-test.invalid:${serverPort}/`);

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    expect(requestCount).toBe(0);
  });
});
