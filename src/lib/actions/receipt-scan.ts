"use server";

// AI receipt scan — src/components/shopping/receipt-scan-dialog.tsx and
// register-receipt-dialog.tsx. Takes a photo of a paper receipt and asks a
// vision model to read off the purchased line items (name/quantity/price)
// and the receipt's currency directly, instead of running Tesseract.js OCR
// client-side and picking lines apart with the regex heuristics in
// receipt-parsing.ts.
//
// That OCR+regex pipeline is what this replaces as the *primary* path: it
// assumes one item name and one trailing price per line, in roughly the
// print layout of a Swedish/English grocery receipt, and a misread digit or
// an unusual layout (multi-line item names, a store that prints unit price
// AND line total, a folded/crumpled receipt) routinely produced missing or
// garbled lines — a vision model reads the receipt as a human would instead
// of pattern-matching printed columns, which is the actual fix for "receipt
// scanning doesn't work very well". receipt-parsing.ts's parseReceiptText/
// detectReceiptCurrency stay in the tree as the *fallback* path both dialogs
// use when no vision provider is configured (see resolveAttempts below) —
// this app shouldn't lose receipt scanning entirely just because nobody set
// GEMINI_API_KEY/ANTHROPIC_API_KEY.
//
// Same provider chain, same "AI suggests, human confirms" shape, and the
// same privacy tradeoff as scanShelfPhotoAction (src/lib/actions/
// inventory-scan.ts): the photo is genuinely uploaded to a third-party API
// (there's no client-side vision model to run this against instead), never
// written to the database — only the reviewed name/quantity/price rows are,
// via applyReceiptScanAction/registerReceiptAction
// (src/app/dashboard/shopping-list/actions.ts), same as an OCR'd line
// always has been.

import { z } from "zod";
import { requireHousehold } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { excerptForLog, logger } from "@/lib/logger";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { receiptLineBarcode } from "@/lib/barcode";

// Same reasoning/measurement as REQUEST_TIMEOUT_MS in inventory-scan.ts —
// shared across every attempt in the chain, kept a bit under this action's
// callers' maxDuration = 60 route config.
const REQUEST_TIMEOUT_MS = 50_000;

// A household scanning several receipts in one grocery run is the normal
// case this should comfortably cover; still tight enough to bound API spend
// from a buggy client or misuse. Kept separate from SCAN_RATE_LIMIT
// (inventory-scan.ts) since the two features are rate-limited independently.
const RECEIPT_SCAN_RATE_LIMIT = 20;
const RECEIPT_SCAN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const NAME_MAX_LENGTH = 120;
const MAX_LINES_PER_SCAN = 80;

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Comfortably above what a client-side-resized photo (see
// src/lib/image-resize.ts) should ever produce; guards against a request
// bypassing the client resize entirely.
const MAX_BASE64_LENGTH = 6_000_000;

const DATA_URL_RE = /^data:([\w./+-]+);base64,([\s\S]+)$/;

// `barcode` (AUTO-11) is only present when the model read a real GTIN off
// the line (check digit verified by receiptLineBarcode) — it lets the
// review dialogs match the line to an item exactly instead of by name.
export type ScannedReceiptLine = { name: string; quantity: number; price: number; barcode?: string };
export type ScanReceiptPhotoResult = { lines?: ScannedReceiptLine[]; currency?: string; error?: string };

const rawReceiptLineSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  quantity: z.coerce.number().positive().max(999).default(1),
  price: z.coerce.number().positive().max(999_999),
  // Coerced from a number too: a model may well return the digits unquoted.
  // Anything malformed is dropped later (receiptLineBarcode), never an error
  // — a bad barcode shouldn't fail an otherwise good scan.
  barcode: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : String(v))),
});
type RawReceiptLine = z.infer<typeof rawReceiptLineSchema>;

const receiptScanSchema = z.object({
  lines: z.array(rawReceiptLineSchema).max(MAX_LINES_PER_SCAN),
  currency: z.string().trim().toUpperCase().length(3).nullable().optional(),
});

const SYSTEM_PROMPT =
  "You are reading a photo of a paper grocery/household store receipt. Report every purchased line item you " +
  "can make out: its product name and the price actually charged for that line (the line's total, not a " +
  "per-unit price shown alongside it). If a line shows a quantity greater than one for the same product " +
  "(e.g. '3 x Milk'), report it as one entry with that quantity and the line's total price, not three " +
  "separate entries. Read each name directly off the receipt — don't shorten, translate, or 'clean up' it " +
  "beyond stripping an obvious store article/PLU number printed next to it. If the line prints the product's " +
  "EAN/UPC barcode digits (usually 8 or 13 digits), report them separately as the line's barcode; otherwise " +
  "leave barcode null — never guess or construct one. Never report a subtotal, tax/VAT " +
  "line, payment method (card/cash/Swish), change given, discount/rounding line, loyalty/membership line, or " +
  "any other receipt boilerplate as if it were a purchased item. Also report the ISO 4217 currency code " +
  `(one of ${SUPPORTED_CURRENCIES.join(", ")}) the receipt's prices are printed in, judging from any currency ` +
  "symbol/code on the receipt or the store's apparent country; leave it null if you genuinely can't tell. " +
  "Report every line item you can read even if the photo is imperfect — skipping an item is only ever better " +
  "than inventing one that isn't really on the receipt.";

/** A provider-specific failure — the message is one of the codes
 * scanReceiptPhotoAction already maps to a translated string in the calling
 * dialogs, so callers can just re-throw it. */
class ScanError extends Error {}

// Same reasoning as inventory-scan.ts: a transient "overloaded"/rate-limited
// response moves on to the next attempt in the chain instead of retrying the
// same busy model.
const RETRYABLE_STATUS = new Set([429, 503, 529]);
const MIN_ATTEMPT_BUDGET_MS = 15_000;

// ---------------------------------------------------------------------------
// Gemini (Google AI Studio) — same REST generateContent + responseSchema
// approach as inventory-scan.ts.
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";

const GEMINI_LINES_SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "The product name, read directly off the receipt line." },
          quantity: {
            type: "NUMBER",
            description: "The quantity printed for this line (e.g. from a leading '3 x'); 1 when none is shown.",
          },
          price: {
            type: "NUMBER",
            description: "The line's total price actually charged, not a per-unit price.",
          },
          barcode: {
            type: "STRING",
            nullable: true,
            description: "The product's EAN/UPC digits if printed on this line, otherwise null.",
          },
        },
        required: ["name", "quantity", "price"],
      },
    },
    currency: {
      type: "STRING",
      nullable: true,
      description: "The ISO 4217 currency code the receipt's prices are in, or null if it can't be determined.",
    },
  },
  required: ["lines"],
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

async function callGemini(
  apiKey: string,
  model: string,
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
): Promise<{ lines: RawReceiptLine[]; currency?: string | null }> {
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: mediaType, data: base64Data } },
            { text: "Here's the receipt. What was purchased?" },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_LINES_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as GeminiResponse | null;
    logger.error("AI receipt scan (Gemini) request failed", {
      model,
      status: response.status,
      message: body?.error?.message,
    });
    throw new ScanError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new ScanError("analysis_failed");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error("AI receipt scan (Gemini) returned non-JSON text", { model, text: excerptForLog(text) });
    throw new ScanError("analysis_failed");
  }

  const parsed = receiptScanSchema.safeParse(json);
  if (!parsed.success) {
    logger.error("AI receipt scan (Gemini) returned an unexpected shape", { model, issues: parsed.error.issues });
    throw new ScanError("analysis_failed");
  }
  return { lines: parsed.data.lines, currency: parsed.data.currency };
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) — last in the chain.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

const RECEIPT_SCAN_TOOL = {
  name: "report_receipt_lines",
  description: "Report every purchased line item on the receipt, plus the currency its prices are printed in.",
  input_schema: {
    type: "object" as const,
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The product name, read directly off the receipt line." },
            quantity: {
              type: "number",
              description: "The quantity printed for this line (e.g. from a leading '3 x'); 1 when none is shown.",
            },
            price: { type: "number", description: "The line's total price actually charged, not a per-unit price." },
            barcode: {
              type: ["string", "null"],
              description: "The product's EAN/UPC digits if printed on this line, otherwise null.",
            },
          },
          required: ["name", "quantity", "price"],
        },
      },
      currency: {
        type: ["string", "null"],
        description: "The ISO 4217 currency code the receipt's prices are in, or null if it can't be determined.",
      },
    },
    required: ["lines"],
  },
};

type AnthropicContentBlock = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
};

async function callAnthropic(
  apiKey: string,
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
): Promise<{ lines: RawReceiptLine[]; currency?: string | null }> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: process.env.RECEIPT_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [RECEIPT_SCAN_TOOL],
      tool_choice: { type: "tool", name: RECEIPT_SCAN_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: "Here's the receipt. What was purchased?" },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AnthropicResponse | null;
    logger.error("AI receipt scan (Anthropic) request failed", { status: response.status, message: body?.error?.message });
    throw new ScanError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as AnthropicResponse;
  const toolUse = data.content?.find(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) throw new ScanError("analysis_failed");

  const parsed = receiptScanSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    logger.error("AI receipt scan (Anthropic) returned an unexpected shape", { issues: parsed.error.issues });
    throw new ScanError("analysis_failed");
  }
  return { lines: parsed.data.lines, currency: parsed.data.currency };
}

// ---------------------------------------------------------------------------

type Attempt =
  | { label: string; kind: "gemini"; apiKey: string; model: string }
  | { label: string; kind: "anthropic"; apiKey: string };

/** Builds the ordered attempt chain: Gemini's primary model, then its
 * fallback model, then Anthropic — each only included when its provider's
 * key is set. Mirrors resolveAttempts in inventory-scan.ts (same env vars,
 * so one GEMINI_API_KEY/ANTHROPIC_API_KEY pair configures both features);
 * RECEIPT_SCAN_MODEL lets the Anthropic model be pinned independently of
 * INVENTORY_SCAN_MODEL if that's ever wanted, but both default the same. */
function resolveAttempts(): Attempt[] {
  const attempts: Attempt[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const primaryModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL;
    attempts.push({ label: `gemini:${primaryModel}`, kind: "gemini", apiKey: geminiKey, model: primaryModel });
    if (fallbackModel && fallbackModel !== primaryModel) {
      attempts.push({ label: `gemini:${fallbackModel}`, kind: "gemini", apiKey: geminiKey, model: fallbackModel });
    }
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) attempts.push({ label: "anthropic", kind: "anthropic", apiKey: anthropicKey });

  return attempts;
}

function callAttempt(
  attempt: Attempt,
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
): Promise<{ lines: RawReceiptLine[]; currency?: string | null }> {
  return attempt.kind === "gemini"
    ? callGemini(attempt.apiKey, attempt.model, mediaType, base64Data, signal)
    : callAnthropic(attempt.apiKey, mediaType, base64Data, signal);
}

type RawScanResult = { lines?: RawReceiptLine[]; currency?: string | null; error?: string };

/** Walks the attempt chain in order, same fallback rules as callAttempts in
 * inventory-scan.ts: only move on for a "busy" provider with time left in
 * the shared deadline, not for a real analysis failure. */
async function callAttempts(
  attempts: Attempt[],
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<RawScanResult> {
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const { lines, currency } = await callAttempt(attempt, mediaType, base64Data, signal);
      return { lines, currency };
    } catch (error) {
      const hasNext = i < attempts.length - 1;
      const hasTime = deadlineAt - Date.now() > MIN_ATTEMPT_BUDGET_MS;

      if (error instanceof ScanError) {
        if (error.message === "provider_busy" && hasNext && hasTime) {
          logger.warn(`AI receipt scan: ${attempt.label} busy, falling back to ${attempts[i + 1].label}`);
          continue;
        }
        return { error: error.message };
      }
      if (error instanceof Error && error.name === "AbortError") {
        logger.error(`AI receipt scan (${attempt.label}) timed out`, { error });
        return { error: "provider_busy" };
      }
      logger.error(`AI receipt scan (${attempt.label}) request errored`, { error });
      return { error: "analysis_failed" };
    }
  }
  // Unreachable: scanReceiptPhotoAction only calls this with a non-empty array.
  return { error: "analysis_failed" };
}

/** Takes a client-captured receipt photo (as a data URL) and returns the
 * first successful attempt's best read of the purchased line items and
 * receipt currency. Every line is a starting point for the review step in
 * ReceiptScanDialog/RegisterReceiptDialog, never written to the database
 * directly. Returns `{ error: "not_configured" }` when neither
 * GEMINI_API_KEY nor ANTHROPIC_API_KEY is set — callers fall back to the
 * client-side OCR+heuristic path (receipt-parsing.ts) in that case. */
export async function scanReceiptPhotoAction(photoDataUrl: string): Promise<ScanReceiptPhotoResult> {
  const { household } = await requireHousehold();

  const attempts = resolveAttempts();
  if (attempts.length === 0) return { error: "not_configured" };

  if (
    !(await checkRateLimit(`ai-receipt-scan:${household.id}`, RECEIPT_SCAN_RATE_LIMIT, RECEIPT_SCAN_RATE_LIMIT_WINDOW_MS))
  ) {
    return { error: "rate_limited" };
  }

  if (photoDataUrl.length > MAX_BASE64_LENGTH) {
    return { error: "photo_too_large" };
  }

  const match = photoDataUrl.match(DATA_URL_RE);
  if (!match) return { error: "invalid_photo" };
  const [, mediaType, base64Data] = match;
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) return { error: "invalid_photo" };

  const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const result = await callAttempts(attempts, mediaType, base64Data, controller.signal, deadlineAt);
    if (result.error) return { error: result.error };
    const currency = result.currency && (SUPPORTED_CURRENCIES as readonly string[]).includes(result.currency)
      ? result.currency
      : undefined;
    const lines: ScannedReceiptLine[] = (result.lines ?? []).map(({ name, quantity, price, barcode }) => {
      const gtin = receiptLineBarcode(barcode);
      return { name, quantity, price, ...(gtin ? { barcode: gtin } : {}) };
    });
    return { lines, currency };
  } finally {
    clearTimeout(timeout);
  }
}
