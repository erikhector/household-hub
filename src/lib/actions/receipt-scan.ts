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
import { DEFAULT_ANTHROPIC_MODEL, resolveAttempts, runProviderChain } from "@/lib/ai/provider-chain";
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

// Gemini's and Anthropic's views of the same answer shape — the chain itself
// (attempt order, busy/deadline fallback, the REST calls) lives in
// src/lib/ai/provider-chain.ts.

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

/** Takes a client-captured receipt photo (as a data URL) and returns the
 * first successful attempt's best read of the purchased line items and
 * receipt currency. Every line is a starting point for the review step in
 * ReceiptScanDialog/RegisterReceiptDialog, never written to the database
 * directly. Returns `{ error: "not_configured" }` when neither
 * GEMINI_API_KEY nor ANTHROPIC_API_KEY is set — callers fall back to the
 * client-side OCR+heuristic path (receipt-parsing.ts) in that case. */
export async function scanReceiptPhotoAction(photoDataUrl: string): Promise<ScanReceiptPhotoResult> {
  const { household } = await requireHousehold();

  const attempts = resolveAttempts({
    anthropicModel: process.env.RECEIPT_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
    geminiFallbackModel: true,
  });
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

  const result = await runProviderChain(attempts, {
    feature: "AI receipt scan",
    systemPrompt: SYSTEM_PROMPT,
    userText: "Here's the receipt. What was purchased?",
    image: { mediaType, base64Data },
    geminiSchema: GEMINI_LINES_SCHEMA,
    anthropicTool: RECEIPT_SCAN_TOOL,
    anthropicMaxTokens: 2048,
    schema: receiptScanSchema,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackOn: "busy",
    failureLevel: "error",
  });
  if (!result.ok) return { error: result.error };
  const currency =
    result.data.currency && (SUPPORTED_CURRENCIES as readonly string[]).includes(result.data.currency)
      ? result.data.currency
      : undefined;
  const lines: ScannedReceiptLine[] = result.data.lines.map(({ name, quantity, price, barcode }) => {
    const gtin = receiptLineBarcode(barcode);
    return { name, quantity, price, ...(gtin ? { barcode: gtin } : {}) };
  });
  return { lines, currency };
}
