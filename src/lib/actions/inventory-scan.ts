"use server";

// AI shelf scan (beta) — src/components/inventory/ai-shelf-scan-dialog.tsx.
// Takes a photo of a shelf/fridge/cupboard and asks a vision model to guess
// what's in it, following the same "AI suggests, human confirms" shape as
// the barcode lookup (src/lib/actions/barcode.ts) and receipt scan
// (src/lib/receipt-parsing.ts): nothing here ever writes to the database —
// the dialog feeds the guesses into bulkCreateInventoryItemsAction (see
// src/app/dashboard/inventory/actions.ts) only after the user reviews and
// confirms them.
//
// Unlike the barcode scanner and receipt OCR (both fully client-side, photo
// never leaves the device), this genuinely uploads the photo to a
// third-party API — there's no client-side vision model to run this against
// instead. The dialog discloses that before the camera opens.
//
// An ordered chain of attempts, built by resolveAttempts — Gemini's primary
// model, then Gemini's fallback model, then Anthropic, skipping whichever
// provider has no key set. Gemini goes first because its free tier
// (generativelanguage.googleapis.com, no card required) makes this feature
// genuinely free to run for a single household, where Anthropic's is
// metered from the first request. callAttempts (below) walks the chain and
// moves to the next entry only when the current one reports itself busy —
// Google's own guidance for an overloaded model is to try a different one
// (a different model is a different capacity pool), so that's tried before
// spending real money falling through to Anthropic.

import { z } from "zod";
import { requireHousehold } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// A live test against Gemini's free-tier gemini-flash-latest took ~41s for
// one successful call (thinking + image tokens both add latency there) —
// comfortably past a shorter timeout, which would abort a call that was
// actually going to succeed. Shared as one deadline across every attempt in
// the chain (see callAttempts below) — kept a bit under the inventory
// page's maxDuration = 60 (src/app/dashboard/inventory/page.tsx) so this
// action's own graceful abort-handling always wins the race against
// Vercel's harder kill, which wouldn't return a clean { error } result at all.
const REQUEST_TIMEOUT_MS = 50_000;

// A household doing a full pantry audit might scan several shelves in one
// sitting — generous enough for that, tight enough that a buggy client
// (or a misuse) can't run up an unbounded API bill. Whoever's on Gemini's
// free tier will likely hit Google's own per-minute cap before this does.
const SCAN_RATE_LIMIT = 20;
const SCAN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Matches itemSchema's own bounds in src/app/dashboard/inventory/actions.ts
// so a guess can always be handed straight to bulkCreateInventoryItemsAction
// without a second round of truncation surprising the user.
const NAME_MAX_LENGTH = 120;
const MAX_ITEMS_PER_SCAN = 40;

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Comfortably above what a client-side-resized photo (see
// ai-shelf-scan-dialog.tsx's canvas downscale) should ever produce; guards
// against a request bypassing the client resize entirely.
const MAX_BASE64_LENGTH = 6_000_000;

const DATA_URL_RE = /^data:([\w./+-]+);base64,([\s\S]+)$/;

export type ScannedShelfItem = { name: string; quantity: number };
export type ScanShelfPhotoResult = { items?: ScannedShelfItem[]; error?: string };

const shelfItemsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
        quantity: z.coerce.number().positive().max(999).default(1),
      }),
    )
    .max(MAX_ITEMS_PER_SCAN),
});

const SYSTEM_PROMPT =
  "You are helping someone take inventory of their kitchen by photographing a shelf, fridge, or cupboard. " +
  "Identify each distinct item visible and estimate how many of each there are. Group identical items into " +
  "one entry with a combined quantity rather than listing them one by one. Skip anything that clearly isn't " +
  "food or a household product (people, furniture, walls). If you can't tell exactly what something is, use " +
  "a generic descriptive name rather than inventing a specific brand or flavor. Report your findings even if " +
  "it's just one or two items — never report nothing if anything identifiable is visible.";

/** A provider-specific failure — the message is one of the codes
 * scanShelfPhotoAction already maps to a translated string in
 * ai-shelf-scan-dialog.tsx, so callers can just re-throw it. */
class ScanError extends Error {}

// Both Gemini and Anthropic occasionally reject a request with a transient
// "the model is overloaded, try again" (Gemini: 503 UNAVAILABLE; Anthropic:
// 529 overloaded_error) or plain rate limiting (429) rather than a real
// failure. Each is a single fetch, no same-model retry — a busy response
// moves on to the *next attempt in the chain* (a different model or
// provider, a different capacity pool) instead of hammering the same
// overloaded one twice, which both wastes shared deadline budget and,
// per Google's own guidance for the 503 case, is less effective than
// trying something different.
const RETRYABLE_STATUS = new Set([429, 503, 529]);
// An attempt is only worth starting if there's realistically enough of the
// shared REQUEST_TIMEOUT_MS budget left for it to complete — a slow attempt
// (rather than a fast overload rejection) can leave too little time for
// another to do anything but get aborted mid-flight, which is exactly what
// surfaced as a raw AbortError instead of a sensible message before this
// check existed.
const MIN_ATTEMPT_BUDGET_MS = 15_000;

// ---------------------------------------------------------------------------
// Gemini (Google AI Studio). Uses the REST generateContent endpoint directly
// (no @google/genai dependency added, same fetch-a-JSON-API convention this
// app already uses for Anthropic below and for
// lookupBarcodeAction/fetchExchangeRate) with responseSchema-constrained
// JSON output instead of Anthropic's forced tool-use — Gemini has no
// tool-choice-style "force this exact tool" mode, but a JSON schema on
// generationConfig gets the same guarantee.
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Both "-latest" values are Google-maintained aliases that always resolve
// to the current stable release of that tier, so neither needs bumping by
// hand as new Gemini versions ship. Flash-Lite is a genuinely separate,
// smaller model — its own capacity pool, not just a renamed Flash — which
// is what makes it worth trying when Flash itself reports overloaded,
// rather than just being another name for the same busy backend.
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";

const GEMINI_ITEMS_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: {
            type: "STRING",
            description:
              "Short, generic product name in Title Case (e.g. 'Milk', 'Canned Tomatoes'). Don't guess a brand you can't actually read on the packaging.",
          },
          quantity: {
            type: "NUMBER",
            description: "How many separate units of this item are visible in the photo.",
          },
        },
        required: ["name", "quantity"],
      },
    },
  },
  required: ["items"],
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
): Promise<ScannedShelfItem[]> {
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
            { text: "Here's the shelf. What's on it?" },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: GEMINI_ITEMS_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as GeminiResponse | null;
    logger.error("AI shelf scan (Gemini) request failed", { model, status: response.status, message: body?.error?.message });
    throw new ScanError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new ScanError("analysis_failed");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    logger.error("AI shelf scan (Gemini) returned non-JSON text", { model, text });
    throw new ScanError("analysis_failed");
  }

  const parsed = shelfItemsSchema.safeParse(json);
  if (!parsed.success) {
    logger.error("AI shelf scan (Gemini) returned an unexpected shape", { model, issues: parsed.error.issues });
    throw new ScanError("analysis_failed");
  }
  return parsed.data.items;
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) — last in the chain.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

const SHELF_SCAN_TOOL = {
  name: "report_shelf_items",
  description:
    "Report every distinct grocery/household item identified in the photo, with an estimated count for each.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Short, generic product name in Title Case (e.g. 'Milk', 'Canned Tomatoes'). Don't guess a brand you can't actually read on the packaging.",
            },
            quantity: {
              type: "number",
              description: "How many separate units of this item are visible in the photo.",
            },
          },
          required: ["name", "quantity"],
        },
      },
    },
    required: ["items"],
  },
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
};

async function callAnthropic(
  apiKey: string,
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
): Promise<ScannedShelfItem[]> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: process.env.INVENTORY_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [SHELF_SCAN_TOOL],
      tool_choice: { type: "tool", name: SHELF_SCAN_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: "Here's the shelf. What's on it?" },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AnthropicResponse | null;
    logger.error("AI shelf scan (Anthropic) request failed", { status: response.status, message: body?.error?.message });
    throw new ScanError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as AnthropicResponse;
  const toolUse = data.content?.find(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) throw new ScanError("analysis_failed");

  const parsed = shelfItemsSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    logger.error("AI shelf scan (Anthropic) returned an unexpected shape", { issues: parsed.error.issues });
    throw new ScanError("analysis_failed");
  }
  return parsed.data.items;
}

// ---------------------------------------------------------------------------

type Attempt =
  | { label: string; kind: "gemini"; apiKey: string; model: string }
  | { label: string; kind: "anthropic"; apiKey: string };

/** Builds the ordered attempt chain: Gemini's primary model, then Gemini's
 * fallback model (skipped if it resolves to the same model id as the
 * primary — e.g. both env vars pointing at the same pin), then Anthropic —
 * each only included when its provider's key is set. With both keys set,
 * Anthropic is a genuine mid-scan fallback for a busy Gemini, not just a
 * fallback for GEMINI_API_KEY being entirely unset — a real (if small,
 * ~$0.01/scan) cost documented in .env.example next to ANTHROPIC_API_KEY. */
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
): Promise<ScannedShelfItem[]> {
  return attempt.kind === "gemini"
    ? callGemini(attempt.apiKey, attempt.model, mediaType, base64Data, signal)
    : callAnthropic(attempt.apiKey, mediaType, base64Data, signal);
}

/** Walks the attempt chain in order, moving to the next entry only when the
 * current one reports itself busy (not for a real analysis failure —
 * that's a bug worth seeing, not something to paper over by trying
 * something else) and there's still enough of the shared deadline left for
 * another attempt to be worth starting. */
async function callAttempts(
  attempts: Attempt[],
  mediaType: string,
  base64Data: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<ScanShelfPhotoResult> {
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      return { items: await callAttempt(attempt, mediaType, base64Data, signal) };
    } catch (error) {
      const hasNext = i < attempts.length - 1;
      const hasTime = deadlineAt - Date.now() > MIN_ATTEMPT_BUDGET_MS;

      if (error instanceof ScanError) {
        if (error.message === "provider_busy" && hasNext && hasTime) {
          logger.warn(`AI shelf scan: ${attempt.label} busy, falling back to ${attempts[i + 1].label}`);
          continue;
        }
        return { error: error.message };
      }
      // The shared timeout firing mid-request surfaces here as a plain
      // AbortError, not a ScanError — the deadline is spent either way, so
      // there's no point trying anything else; report it as the same
      // "busy, try again" case as a provider overload rather than the
      // generic failure message, since that's what it is from the user's side.
      if (error instanceof Error && error.name === "AbortError") {
        logger.error(`AI shelf scan (${attempt.label}) timed out`, { error });
        return { error: "provider_busy" };
      }
      logger.error(`AI shelf scan (${attempt.label}) request errored`, { error });
      return { error: "analysis_failed" };
    }
  }
  // Unreachable: scanShelfPhotoAction only calls this with a non-empty array.
  return { error: "analysis_failed" };
}

/** Takes a client-captured photo (as a data URL) and returns the first
 * successful attempt's best guess at the grocery/household items visible
 * in it. Every guess is a starting point for the review step in
 * ai-shelf-scan-dialog.tsx, never written to the database directly. */
export async function scanShelfPhotoAction(photoDataUrl: string): Promise<ScanShelfPhotoResult> {
  const { household } = await requireHousehold();

  const attempts = resolveAttempts();
  if (attempts.length === 0) return { error: "not_configured" };

  if (!(await checkRateLimit(`ai-shelf-scan:${household.id}`, SCAN_RATE_LIMIT, SCAN_RATE_LIMIT_WINDOW_MS))) {
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
    return await callAttempts(attempts, mediaType, base64Data, controller.signal, deadlineAt);
  } finally {
    clearTimeout(timeout);
  }
}
