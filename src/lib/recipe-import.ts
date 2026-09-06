// Recipe import from URL — pure parsing logic (JSON-LD extraction, ingredient
// splitting, instruction flattening) plus the SSRF-guarding URL validation and
// fetch used by importRecipeFromUrlAction
// (src/app/dashboard/meal-planning/actions.ts). The parsing functions below
// take no network dependency and are unit-tested with inline HTML/JSON
// fixtures in recipe-import.test.ts; fetchRecipeHtml is the only part that
// touches the network and isn't exercised by tests.
import { promises as dns } from "node:dns";
import net from "node:net";

export type ParsedIngredient = { name: string; quantity: number; unit: string };
export type ParsedRecipe = {
  name: string;
  instructions: string;
  ingredients: ParsedIngredient[];
};

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

// The `type` attribute value is usually quoted, but HTML5 also allows an
// unquoted value when it contains no whitespace/quotes/`=`/`<`/`>` —
// `application/ld+json` qualifies, and real sites use this (e.g. Yoast
// SEO's `<script type=application/ld+json class=yoast-schema-graph>`,
// found on a huge share of WordPress recipe blogs). The lookahead after the
// unquoted alternative stops it from matching a value that merely starts
// with `application/ld+json` followed by more non-delimiter characters.
const JSON_LD_SCRIPT_RE =
  /<script[^>]*type\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?=[\s/>]))[^>]*>([\s\S]*?)<\/script>/gi;

/** Extract the raw text content of every `<script type="application/ld+json">` block. */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    if (match[1] !== undefined) blocks.push(match[1]);
  }
  return blocks;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type JsonLdNode = Record<string, unknown>;

function tryParseJson(raw: string): unknown | undefined {
  for (const candidate of [raw, decodeHtmlEntities(raw)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function typeIncludes(node: JsonLdNode, type: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === type;
  if (Array.isArray(t)) return t.includes(type);
  return false;
}

function searchForRecipeNode(value: unknown): JsonLdNode | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchForRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const node = value as JsonLdNode;
    if (typeIncludes(node, "Recipe")) return node;
    if (Array.isArray(node["@graph"])) {
      const found = searchForRecipeNode(node["@graph"]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Scan every JSON-LD block for an object (or an item inside an `@graph`
 * array) whose `@type` includes "Recipe". Returns the first match, or null.
 */
export function findRecipeNode(jsonLdBlocks: string[]): JsonLdNode | null {
  for (const block of jsonLdBlocks) {
    const parsed = tryParseJson(block.trim());
    if (parsed === undefined) continue;
    const found = searchForRecipeNode(parsed);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ingredient-string splitting
// ---------------------------------------------------------------------------

const KNOWN_UNITS = new Set([
  "cup",
  "cups",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "mg",
  "ml",
  "milliliter",
  "milliliters",
  "millilitre",
  "millilitres",
  "l",
  "liter",
  "liters",
  "litre",
  "litres",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "clove",
  "cloves",
  "can",
  "cans",
  "slice",
  "slices",
  "pinch",
  "pinches",
  "dash",
  "dashes",
  "package",
  "packages",
  "pkg",
  "bunch",
  "bunches",
  "head",
  "heads",
  "stalk",
  "stalks",
  "piece",
  "pieces",
  "pcs",
  "pc",
  // Swedish (e.g. ICA recipes) — schema.org Recipe JSON-LD gives these as
  // plain measure words in `recipeIngredient`, same as the English ones above.
  "dl",
  "msk",
  "tsk",
  "krm",
  "st",
  "förp",
  "port",
  "ask",
  "burk",
  "påse",
  "klyfta",
  "klyftor",
  "skiva",
  "skivor",
  "kruka",
  "näve",
]);

function parseLeadingQuantity(raw: string): number | null {
  if (raw.includes(" ")) {
    // Mixed number, e.g. "1 1/2"
    const [whole, frac] = raw.split(" ");
    const [n, d] = frac.split("/").map(Number);
    if (!d) return null;
    const wholeNum = Number(whole);
    if (!Number.isFinite(wholeNum) || !Number.isFinite(n)) return null;
    return wholeNum + n / d;
  }
  if (raw.includes("/")) {
    const [n, d] = raw.split("/").map(Number);
    if (!d || !Number.isFinite(n)) return null;
    return n / d;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const LEADING_QUANTITY_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(.*)$/;

/**
 * Best-effort split of a schema.org `recipeIngredient` string (e.g.
 * "2 cups flour", "1 1/2 tbsp olive oil", "a pinch of salt") into
 * quantity/unit/name. Falls back to putting the whole string in `name` with
 * quantity 1 whenever it can't confidently split — never guesses wrong.
 */
export function parseIngredientString(raw: string): ParsedIngredient {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { name: "", quantity: 1, unit: "pcs" };

  const match = trimmed.match(LEADING_QUANTITY_RE);
  if (!match) return { name: trimmed, quantity: 1, unit: "pcs" };

  const [, qtyRaw, rest] = match;
  const quantity = parseLeadingQuantity(qtyRaw);
  if (quantity === null || quantity <= 0 || !rest) {
    return { name: trimmed, quantity: 1, unit: "pcs" };
  }

  const restWords = rest.split(" ");
  const firstWord = restWords[0]?.toLowerCase().replace(/[.,]$/, "") ?? "";
  if (KNOWN_UNITS.has(firstWord) && restWords.length > 1) {
    return { name: restWords.slice(1).join(" ").trim(), quantity, unit: firstWord };
  }

  return { name: rest.trim(), quantity, unit: "pcs" };
}

// ---------------------------------------------------------------------------
// Instruction flattening
// ---------------------------------------------------------------------------

function flattenInstructionItem(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const node = item as JsonLdNode;
    if (Array.isArray(node.itemListElement)) {
      return node.itemListElement
        .map((sub) => flattenInstructionItem(sub))
        .filter(Boolean)
        .join("\n");
    }
    if (typeof node.text === "string") return node.text.trim();
    if (typeof node.name === "string") return node.name.trim();
  }
  return "";
}

/**
 * schema.org's `recipeInstructions` can be a plain string, an array of
 * strings, or an array of `HowToStep`/`HowToSection` objects. Flatten to
 * plain text, one step per line.
 */
export function flattenInstructions(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenInstructionItem(item))
      .filter(Boolean)
      .join("\n");
  }
  return flattenInstructionItem(value);
}

// ---------------------------------------------------------------------------
// Mapping a JSON-LD Recipe node to the form's shape
// ---------------------------------------------------------------------------

export function mapJsonLdToRecipe(node: JsonLdNode): ParsedRecipe {
  const name = typeof node.name === "string" ? node.name.trim() : "";

  const rawIngredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient
    : Array.isArray(node.ingredients)
      ? node.ingredients
      : [];
  const ingredients = rawIngredients
    .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
    .map(parseIngredientString);

  const instructions = flattenInstructions(node.recipeInstructions);

  return { name, instructions, ingredients };
}

/**
 * End-to-end pure parse: raw page HTML -> a ParsedRecipe, or null if no
 * schema.org Recipe JSON-LD could be found/parsed.
 */
export function parseRecipeFromHtml(html: string): ParsedRecipe | null {
  const blocks = extractJsonLdBlocks(html);
  const node = findRecipeNode(blocks);
  if (!node) return null;

  const recipe = mapJsonLdToRecipe(node);
  if (!recipe.name && recipe.ingredients.length === 0 && !recipe.instructions) return null;
  return recipe;
}

// ---------------------------------------------------------------------------
// SSRF-guarding URL validation + fetch
// ---------------------------------------------------------------------------

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

async function assertResolvesToPublicAddress(hostname: string): Promise<boolean> {
  const ipFamily = net.isIP(hostname);
  if (ipFamily) return true; // already checked by validateRecipeUrl

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return false; // unresolvable — refuse rather than guess safe
  }
  if (records.length === 0) return false;

  for (const record of records) {
    if (record.family === 4 && isPrivateOrReservedIPv4(record.address)) return false;
    if (record.family === 6 && isPrivateOrReservedIPv6(record.address)) return false;
  }
  return true;
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3MB — plenty for a recipe page's HTML
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 8000;

async function readBodyWithLimit(response: Response, limitBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limitBytes) {
          await reader.cancel();
          throw new Error("tooLarge");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

export type FetchRecipeError =
  | UrlValidationError
  | "fetchFailed"
  | "tooLarge"
  | "tooManyRedirects";
export type FetchRecipeResult = { ok: true; html: string } | { ok: false; error: FetchRecipeError };

/**
 * Fetches a user-supplied recipe URL server-side, guarding against SSRF:
 * only http(s), never a private/loopback/link-local/reserved IP (checked
 * both as a literal in the URL and after DNS resolution, to also cover DNS
 * rebinding), redirects followed manually so every hop is re-validated the
 * same way, and the response body capped in size while streaming.
 */
export async function fetchRecipeHtml(rawUrl: string): Promise<FetchRecipeResult> {
  const initial = validateRecipeUrl(rawUrl);
  if (!initial.ok) return initial;

  let currentUrl = initial.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await assertResolvesToPublicAddress(currentUrl.hostname);
    if (!safe) return { ok: false, error: "blockedHost" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "HouseholdHubRecipeImporter/1.0" },
      });
    } catch {
      return { ok: false, error: "fetchFailed" };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
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

    if (!response.ok) return { ok: false, error: "fetchFailed" };

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      return { ok: false, error: "tooLarge" };
    }

    try {
      const html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
      return { ok: true, html };
    } catch {
      return { ok: false, error: "tooLarge" };
    }
  }

  return { ok: false, error: "tooManyRedirects" };
}
