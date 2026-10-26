// Runs src/lib/service-worker.js against a fake worker scope (no real
// ServiceWorkerGlobalScope in the node environment) and checks which
// requests its fetch handler takes over: hashed /_next/static/* files go
// cache-first, everything else must be left to the network.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Handler = (event: unknown) => void;

// A constructed Response has type "default"; a real same-origin fetch result
// is "basic", which is what the worker requires before caching.
function basic(body: string, status = 200) {
  const response = new Response(body, { status });
  Object.defineProperty(response, "type", { value: "basic" });
  response.clone = () => basic(body, status);
  return response;
}

function load(href = "https://app.test/sw.js?prod=1") {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name)!;
  };
  const caches = {
    open: async (name: string) => {
      const s = store(name);
      return {
        match: async (req: Request | string) => s.get(typeof req === "string" ? req : req.url)?.clone(),
        put: async (req: Request, res: Response) => void s.set(req.url, res),
        keys: async () => [...s.keys()].map((url) => new Request(url)),
        delete: async (req: Request) => s.delete(req.url),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async () => undefined,
  };
  const fetchMock = vi.fn(async () => basic("body"));
  const self = {
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    location: { origin: "https://app.test", href },
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: {},
    skipWaiting: () => {},
  };
  const source = readFileSync(join(__dirname, "service-worker.js"), "utf8");
  new Function("self", "caches", "fetch", source)(self, caches, fetchMock);
  return { handlers, stores, fetchMock };
}

function fire(handlers: Record<string, Handler>, request: Request) {
  let responded: Promise<Response> | undefined;
  const pending: Promise<unknown>[] = [];
  handlers.fetch({
    request,
    respondWith: (p: Promise<Response>) => void (responded = p),
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  });
  return { responded, settle: () => Promise.all(pending) };
}

const chunk = "https://app.test/_next/static/chunks/abc123.js";

describe("service worker static cache", () => {
  it("fetches a hashed asset once, then serves it from the cache", async () => {
    const { handlers, fetchMock } = load();
    const first = fire(handlers, new Request(chunk));
    await first.responded;
    await first.settle();
    const second = fire(handlers, new Request(chunk));
    expect(await (await second.responded)!.text()).toBe("body");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves pages, RSC, API and cross-origin requests to the network", () => {
    const { handlers } = load();
    for (const url of [
      "https://app.test/api/health",
      "https://app.test/dashboard?_rsc=1x",
      "https://app.test/_next/image?url=%2Fa.png",
      "https://other.test/_next/static/chunks/abc123.js",
    ]) {
      expect(fire(handlers, new Request(url)).responded).toBeUndefined();
    }
    expect(fire(handlers, new Request(chunk, { method: "POST" })).responded).toBeUndefined();
    expect(fire(handlers, new Request(chunk, { headers: { Range: "bytes=0-9" } })).responded).toBeUndefined();
  });

  it("stays network-only when registered without the production flag (next dev)", () => {
    const { handlers } = load("https://app.test/sw.js");
    expect(fire(handlers, new Request(chunk)).responded).toBeUndefined();
  });

  it("does not cache a failed response", async () => {
    const { handlers, stores, fetchMock } = load();
    fetchMock.mockResolvedValueOnce(basic("nope", 404));
    const result = fire(handlers, new Request(chunk));
    expect((await result.responded)!.status).toBe(404);
    await result.settle();
    expect(stores.get("squirrel-static-v1")?.size ?? 0).toBe(0);
  });

  it("caps the cache, dropping the oldest entries", async () => {
    const { handlers, stores } = load();
    for (let i = 0; i < 402; i++) {
      const result = fire(handlers, new Request(`https://app.test/_next/static/chunks/c${i}.js`));
      await result.responded;
      await result.settle();
    }
    const urls = [...stores.get("squirrel-static-v1")!.keys()];
    expect(urls).toHaveLength(400);
    expect(urls[0]).toContain("/c2.js");
  });

  it("drops static caches from an older worker version on activate", async () => {
    const { handlers, stores } = load();
    stores.set("squirrel-static-v0", new Map());
    stores.set("squirrel-offline-v1", new Map());
    let done: Promise<unknown> | undefined;
    handlers.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
    expect([...stores.keys()]).toEqual(["squirrel-offline-v1"]);
  });
});
