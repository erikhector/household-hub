import { promises as dns, type LookupAddress, type LookupOptions } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";


export type UrlValidationError = "invalidUrl" | "blockedHost";
export type UrlValidationResult = { ok: true; url: URL } | { ok: false; error: UrlValidationError };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

// [network, prefixLength] pairs for every private/reserved/link-local/etc.
// IPv4 range that must never be reachable from a server-side fetch of a
// user-supplied URL.
const PRIVATE_IPV4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

export function isPrivateOrReservedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparsable — refuse rather than guess safe
  for (const [network, prefix] of PRIVATE_IPV4_CIDRS) {
    const networkValue = ipv4ToInt(network);
    if (networkValue === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) === (networkValue & mask)) return true;
  }
  return false;
}

export function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9")) return true; // link-local (fe80::/10)
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("2001:db8:")) return true; // documentation
  // IPv4-mapped addresses (::ffff:a.b.c.d) — check the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

/**
 * Pure (no network) validation: scheme must be http(s), and if the hostname
 * is itself an IP literal it must not be private/reserved. Doesn't catch a
 * hostname that *resolves* to a private IP — see fetchRecipeHtml's DNS check
 * for that.
 */
export function validateRecipeUrl(rawUrl: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalidUrl" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "invalidUrl" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, error: "blockedHost" };
  }

  const ipFamily = net.isIP(hostname);
  if (ipFamily === 4 && isPrivateOrReservedIPv4(hostname)) {
    return { ok: false, error: "blockedHost" };
  }
  if (ipFamily === 6 && isPrivateOrReservedIPv6(hostname)) {
    return { ok: false, error: "blockedHost" };
  }

  return { ok: true, url };
}

// A `net.connect`-compatible `lookup` error code for "this hostname
// resolves to a private/reserved address" — distinct from Node's own
// ENOTFOUND/etc. so fetchRecipeHtml's catch block can tell a blocked host
// apart from a plain connection failure and report "blockedHost" instead of
// a generic "fetchFailed".
const EBLOCKEDHOST = "EBLOCKEDHOST";

// Test-only seam (SEC-2): recipe-import/fetch.test.ts fakes node:http/https to
// exercise most of fetchRecipeHtml without a real connection, but that
// can't by itself prove createPinnedPublicLookup satisfies Node's *real*
// lookup contract (the fake only does what it's coded to do). Proving that
// means running a real `http.createServer` round trip through real
// `http.request` — which means the target has to be loopback, and loopback
// is exactly what this function exists to block. This override lets a test
// swap in a different private-address check for that one round trip
// (mocking `dns.lookup` to point at the local test server, and this to
// treat that address as "public" for the purpose of the test) while
// everything else — the real Node `lookup` contract, the real connect,
// the real body read — stays real. Never touched outside tests; always
// null in production.
type PrivateAddressCheck = (address: string, family: number) => boolean;
let privateAddressCheckOverride: PrivateAddressCheck | null = null;
export function _setPrivateAddressCheckForTests(check: PrivateAddressCheck | null): void {
  privateAddressCheckOverride = check;
}
function isPrivateOrReservedAddress(address: string, family: number): boolean {
  if (privateAddressCheckOverride) return privateAddressCheckOverride(address, family);
  return family === 4 ? isPrivateOrReservedIPv4(address) : isPrivateOrReservedIPv6(address);
}

/**
 * A `net.connect`-compatible `lookup` for `http(s).request`, pinning DNS
 * resolution to the exact address the socket goes on to connect to (SEC-2).
 *
 * The previous version resolved the hostname once up front to check it was
 * public (`dns.lookup` in `assertResolvesToPublicAddress`), then let
 * `fetch` resolve the *same hostname again* to actually connect. Those are
 * two independent DNS queries, and a TTL-0 or otherwise hostile DNS server
 * can answer them differently — return a public address the first time
 * (passing the check) and a private one (`127.0.0.1`, the cloud metadata
 * address `169.254.169.254`, …) the second, which is exactly what the
 * socket then connects to. This is the standard DNS-rebinding SSRF bypass.
 *
 * Passing this function as `lookup` to `http(s).request` means the
 * request's *only* resolution is this one, and Node connects to whichever
 * address it hands back — so validating here is validating what's actually
 * connected to, with no gap for a second query to answer differently in.
 *
 * `dns.lookup(..., { all: true })` can return several records (multiple A
 * results, A + AAAA, …), and Node tries them in order until one connects —
 * so every record must be checked, not just the first, or a rebinding
 * attacker could list a public "decoy" address alongside a private one and
 * rely on the client eventually trying the private one.
 *
 * This must follow `dns.lookup`'s own callback contract, not a simplified
 * one, because Node calls it that way whether we like it or not: `net`'s
 * `autoSelectFamily` (on by default since Node 20) makes `http(s).request`
 * always call `lookup` with `{ all: true, ... }` so it can attempt multiple
 * resolved addresses (Happy Eyeballs) — never the single
 * `(address, family)` shape. A `lookup` that always calls back with a
 * single address regardless of `options.all` breaks *every* request with
 * `ERR_INVALID_IP_ADDRESS` (address undefined), because Node passes that
 * single value through `isIP()` expecting the array shape it asked for.
 * `options.family` (4 or 6) is honored too, the same way `dns.lookup`
 * itself would filter, when a caller asks for just one.
 */
function normalizeFamily(family: LookupOptions["family"]): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return family || 0; // 0 (or unset) means "either"
}

function createPinnedPublicLookup(): (
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true }).then(
      (records) => {
        if (records.length === 0) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
          return;
        }
        // Every resolved record must be validated, regardless of which
        // family the caller ends up wanting — an attacker could otherwise
        // hide a private address behind a family Node didn't ask for this
        // time (e.g. it wants AAAA now, A later) and have it validated as
        // "safe" simply because it wasn't looked at.
        const blocked = records.some((record) => isPrivateOrReservedAddress(record.address, record.family));
        if (blocked) {
          callback(
            Object.assign(new Error(`${hostname} resolves to a private/reserved address`), {
              code: EBLOCKEDHOST,
            }),
            "",
          );
          return;
        }

        const wantFamily = normalizeFamily(options.family);
        const matching = wantFamily ? records.filter((record) => record.family === wantFamily) : records;
        if (matching.length === 0) {
          callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "");
          return;
        }

        if (options.all) {
          callback(
            null,
            matching.map((record) => ({ address: record.address, family: record.family })),
          );
        } else {
          callback(null, matching[0].address, matching[0].family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

const RECIPE_IMPORT_USER_AGENT = "HouseholdHubRecipeImporter/1.0";

type RawHttpResponse = { statusCode: number; headers: http.IncomingHttpHeaders; body: IncomingMessage };

/** One GET with DNS pinned via createPinnedPublicLookup; redirects are left for the caller to follow manually. */
function requestOnce(url: URL, signal: AbortSignal): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": RECIPE_IMPORT_USER_AGENT },
        // Forces a fresh socket (and so a fresh `lookup` call) for this
        // request — a pooled keep-alive socket from an earlier request
        // could otherwise be reused for a different hop's hostname without
        // ever going through `lookup` again.
        agent: false,
        lookup: createPinnedPublicLookup(),
        signal,
      },
      (res) => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    req.on("error", reject);
    req.end();
  });
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB — plenty for a recipe page's HTML
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8000;

/** Reads a Node response stream up to `limitBytes`, destroying it and rejecting once exceeded. */
function readBodyWithLimit(body: IncomingMessage, limitBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    body.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        body.destroy();
        reject(new Error("tooLarge"));
        return;
      }
      chunks.push(chunk);
    });
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    body.on("error", reject);
  });
}

export type FetchRecipeError =
  | UrlValidationError
  | "fetchFailed"
  | "tooLarge"
  | "tooManyRedirects";
export type FetchRecipeResult = { ok: true; html: string } | { ok: false; error: FetchRecipeError };

/**
 * Fetches a user-supplied recipe URL server-side, guarding against SSRF:
 * only http(s), never a private/loopback/link-local/reserved IP (checked as
 * a literal in the URL by validateRecipeUrl, and after DNS resolution by
 * createPinnedPublicLookup — see its comment for why that's the *same*
 * lookup used to connect, closing the DNS-rebinding gap a separate
 * check-then-fetch resolution would leave open), redirects followed
 * manually so every hop is re-validated the same way, and the response
 * body capped in size while streaming.
 *
 * Built on node:http/https rather than `fetch` specifically so the lookup
 * that *validates* a hostname is the one that *connects* to it (fetch/undici
 * has no supported hook for that short of constructing an `undici.Agent`,
 * and undici isn't a direct dependency here). One consequence: this doesn't
 * send `Accept-Encoding`, so responses arrive uncompressed instead of via
 * fetch's automatic gzip/br negotiation — heavier over the wire, but this
 * fetches one page per import and MAX_RESPONSE_BYTES still applies.
 *
 * The abort timer set per hop stays armed through the body read below, not
 * just until headers arrive — a slow-drip response has nothing else to cut
 * it off past FETCH_TIMEOUT_MS otherwise (SEC-2).
 */
export async function fetchRecipeHtml(rawUrl: string): Promise<FetchRecipeResult> {
  const initial = validateRecipeUrl(rawUrl);
  if (!initial.ok) return initial;

  let currentUrl = initial.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await requestOnce(currentUrl, controller.signal);

      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.body.resume(); // discard the redirect's own body, if any
        const location = response.headers.location;
        if (!location) return { ok: false, error: "fetchFailed" };
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return { ok: false, error: "invalidUrl" };
        }
        const nextValidated = validateRecipeUrl(nextUrl.toString());
        if (!nextValidated.ok) return nextValidated;
        currentUrl = nextValidated.url;
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.resume();
        return { ok: false, error: "fetchFailed" };
      }

      const contentLength = response.headers["content-length"];
      if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
        response.body.resume();
        return { ok: false, error: "tooLarge" };
      }

      try {
        const html = await readBodyWithLimit(response.body, MAX_RESPONSE_BYTES);
        return { ok: true, html };
      } catch {
        return { ok: false, error: "tooLarge" };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === EBLOCKEDHOST) return { ok: false, error: "blockedHost" };
      return { ok: false, error: "fetchFailed" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: "tooManyRedirects" };
}
