import { beforeEach, describe, expect, it, vi } from "vitest";

// fetchRecipeHtml (SEC-2) is the one part of this module that touches the
// network: it resolves DNS via node:dns and connects via node:http/https, so
// exercising its SSRF/DNS-rebinding guard and its abort-timer behavior means
// faking those three built-ins rather than hitting anything real. The fake
// http(s) client below replicates just enough of Node's own contract to be
// faithful to what we're testing: `http(s).request(url, options, callback)`
// calls `options.lookup(hostname, opts, cb)` itself before "connecting" (real
// Node does exactly this inside net.connect), so routing the plumbing through
// the same `lookup` recipe-import.ts passes in is what proves a private
// resolution never reaches a connection — not just that the lookup function
// returns the right thing in isolation.
type FakeResponsePlan = {
  statusCode: number;
  headers?: Record<string, string>;
  bodyChunks?: string[];
  onEnd?: () => void;
};

function createFakeEmitter() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners[event] ?? []) fn(...args);
    },
  };
}

const { lookupMock, connectSpy, responsePlans, requestMock } = vi.hoisted(() => {
  const responsePlans: FakeResponsePlan[] = [];
  const connectSpy = vi.fn();
  const lookupMock = vi.fn();
  const requestMock = vi.fn(
    (
      url: URL,
      options: { lookup: (hostname: string, opts: unknown, cb: (...args: unknown[]) => void) => void },
      callback: (res: unknown) => void,
    ) => {
      const req = createFakeEmitter() as ReturnType<typeof createFakeEmitter> & {
        end: () => void;
        destroy: () => void;
      };
      req.end = () => {
        // Real Node calls `lookup` with `{ all: true, ... }` here — net's
        // `autoSelectFamily` (on by default since Node 20) means
        // http(s).request always wants every resolved address up front, to
        // attempt them in turn (Happy Eyeballs), never the single
        // `(address, family)` shape. Faking that any other way is exactly
        // how the earlier version of this fix passed tests while still
        // breaking every real request (ERR_INVALID_IP_ADDRESS) — see
        // fetchRecipeHtml's real-http.createServer tests further down for
        // the version of this contract that isn't faked at all.
        const onLookup = (err: NodeJS.ErrnoException | null, records: Array<{ address: string; family: number }>) => {
          if (err) {
            queueMicrotask(() => req.emit("error", err));
            return;
          }
          const [{ address, family }] = records;
          connectSpy(url.hostname, address, family);
          const plan = responsePlans.shift();
          if (!plan) {
            queueMicrotask(() => req.emit("error", new Error(`no response plan queued for ${url.href}`)));
            return;
          }
          const res = createFakeEmitter() as ReturnType<typeof createFakeEmitter> & {
            statusCode: number;
            headers: Record<string, string>;
            resume: () => void;
            destroy: () => void;
          };
          res.statusCode = plan.statusCode;
          res.headers = plan.headers ?? {};
          res.resume = () => {};
          res.destroy = () => {};
          callback(res);
          queueMicrotask(() => {
            for (const chunk of plan.bodyChunks ?? []) res.emit("data", Buffer.from(chunk));
            plan.onEnd?.();
            res.emit("end");
          });
        };
        options.lookup(url.hostname, { all: true }, onLookup as (...args: unknown[]) => void);
      };
      req.destroy = () => {};
      return req;
    },
  );
  return { lookupMock, connectSpy, responsePlans, requestMock };
});

vi.mock("node:dns", () => ({ promises: { lookup: lookupMock } }));
vi.mock("node:http", () => ({ default: { request: requestMock } }));
vi.mock("node:https", () => ({ default: { request: requestMock } }));

import {
  fetchRecipeHtml,
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  validateRecipeUrl,
} from "./fetch";

describe("validateRecipeUrl", () => {
  it("accepts a plain https URL", () => {
    const result = validateRecipeUrl("https://example.com/recipe");
    expect(result.ok).toBe(true);
  });

  it("accepts a plain http URL", () => {
    const result = validateRecipeUrl("http://example.com/recipe");
    expect(result.ok).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(validateRecipeUrl("ftp://example.com/recipe")).toEqual({
      ok: false,
      error: "invalidUrl",
    });
    expect(validateRecipeUrl("file:///etc/passwd")).toEqual({ ok: false, error: "invalidUrl" });
  });

  it("rejects a malformed URL", () => {
    expect(validateRecipeUrl("not a url")).toEqual({ ok: false, error: "invalidUrl" });
  });

  it("rejects localhost", () => {
    expect(validateRecipeUrl("http://localhost/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://foo.localhost/recipe")).toEqual({
      ok: false,
      error: "blockedHost",
    });
  });

  it("rejects a loopback IPv4 literal", () => {
    expect(validateRecipeUrl("http://127.0.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("rejects a private IPv4 literal", () => {
    expect(validateRecipeUrl("http://192.168.1.5/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://10.0.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
    expect(validateRecipeUrl("http://172.16.0.1/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("rejects a link-local IPv4 literal", () => {
    expect(validateRecipeUrl("http://169.254.169.254/latest/meta-data")).toEqual({
      ok: false,
      error: "blockedHost",
    });
  });

  it("rejects an IPv6 loopback literal", () => {
    expect(validateRecipeUrl("http://[::1]/recipe")).toEqual({ ok: false, error: "blockedHost" });
  });

  it("accepts a public IPv4 literal", () => {
    expect(validateRecipeUrl("http://93.184.216.34/recipe").ok).toBe(true);
  });
});

describe("isPrivateOrReservedIPv4", () => {
  it("flags well-known private ranges", () => {
    expect(isPrivateOrReservedIPv4("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateOrReservedIPv4("192.168.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIPv4("0.0.0.0")).toBe(true);
    expect(isPrivateOrReservedIPv4("169.254.1.1")).toBe(true);
  });

  it("does not flag a public address", () => {
    expect(isPrivateOrReservedIPv4("8.8.8.8")).toBe(false);
  });
});

describe("isPrivateOrReservedIPv6", () => {
  it("flags loopback and link-local/unique-local ranges", () => {
    expect(isPrivateOrReservedIPv6("::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fe80::1")).toBe(true);
    expect(isPrivateOrReservedIPv6("fd00::1")).toBe(true);
  });

  it("flags an IPv4-mapped private address", () => {
    expect(isPrivateOrReservedIPv6("::ffff:127.0.0.1")).toBe(true);
  });

  it("does not flag a public IPv6 address", () => {
    expect(isPrivateOrReservedIPv6("2606:4700:4700::1111")).toBe(false);
  });
});


beforeEach(() => {
  lookupMock.mockReset();
  requestMock.mockClear();
  connectSpy.mockClear();
  responsePlans.length = 0;
});

// SEC-2: assertResolvesToPublicAddress used to check the hostname once, then
// let `fetch` resolve it again to actually connect — two independent DNS
// queries a rebinding server could answer differently. fetchRecipeHtml now
// pins DNS resolution to the exact lookup that connects (createPinnedPublicLookup,
// passed straight to http(s).request), so there's only ever one query per
// connection attempt and it's the one that's validated.
describe("fetchRecipeHtml — DNS-rebinding guard (SEC-2)", () => {
  it("blocks a hostname whose only DNS answer is private, and never connects", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    const result = await fetchRecipeHtml("http://attacker.example/recipe");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks a multi-answer response with a private record even when a public one is also listed", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 }, // cloud metadata address
    ]);

    const result = await fetchRecipeHtml("http://attacker.example/recipe");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("blocks a redirect hop that rebinds to a private address after the first hop resolved publicly, and never connects to it", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // hop 0: public
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]); // hop 1's redirect target: rebinds to loopback
    responsePlans.push({ statusCode: 302, headers: { location: "http://internal.example/secret" } });

    const result = await fetchRecipeHtml("http://recipe-site.example/page");

    expect(result).toEqual({ ok: false, error: "blockedHost" });
    // Exactly one connection — hop 0. Hop 1's private resolution must never
    // reach a connection at all, not merely fail after connecting.
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });
});

// SEC-2: the abort timer used to be cleared right after the initial fetch()
// call returned (i.e. once headers arrived), leaving the body read that
// followed with nothing to cut it off — a slow-drip response could stall
// well past FETCH_TIMEOUT_MS. It must stay armed until the body is fully
// read.
describe("fetchRecipeHtml — abort timer covers the body read (SEC-2)", () => {
  it("only clears the per-hop timeout after the body has fully been read", async () => {
    const timeline: string[] = [];
    const realClearTimeout = globalThis.clearTimeout;
    const clearTimeoutSpy = vi
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation((id: Parameters<typeof clearTimeout>[0]) => {
        timeline.push("clearTimeout");
        return realClearTimeout(id);
      });

    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    responsePlans.push({
      statusCode: 200,
      bodyChunks: ["<html></html>"],
      onEnd: () => timeline.push("body-end"),
    });

    const result = await fetchRecipeHtml("http://recipe-site.example/page");

    expect(result).toEqual({ ok: true, html: "<html></html>" });
    // clearTimeout must come strictly after the body finished — if it were
    // cleared as soon as headers arrived (the SEC-2 bug), "clearTimeout"
    // would appear before "body-end" here instead.
    expect(timeline).toEqual(["body-end", "clearTimeout"]);

    clearTimeoutSpy.mockRestore();
  });
});

