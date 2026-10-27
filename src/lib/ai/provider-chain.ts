// One AI provider chain, shared by AI shelf scan (src/lib/actions/
// inventory-scan.ts), AI receipt scan (src/lib/actions/receipt-scan.ts) and
// the AI category fallback (src/lib/inventory/ai-category-fallback.ts).
// Before MAINT-8 each of those carried its own copy of the Gemini and
// Anthropic REST calls and the fallback loop, none of it tested. Each
// feature now supplies only what differs — prompt, user content, the
// response schema in both providers' dialects, a Zod schema for the answer
// — and this module owns the rest: building the ordered attempt list from
// the environment, one fetch per attempt (no same-model retry), and the
// fallback rules.
//
// Gemini goes first because its free tier (no card required) makes these
// features genuinely free to run for a single household, where Anthropic's
// is metered from the first request. Uses the REST generateContent endpoint
// directly (no @google/genai dependency, same fetch-a-JSON-API convention
// as lookupBarcodeAction/fetchExchangeRate) with a responseSchema-
// constrained JSON answer; Anthropic gets the same guarantee through forced
// tool use.

import type { z } from "zod";
import { excerptForLog, logger } from "@/lib/logger";

/** A provider-specific failure. The message is one of the codes the calling
 * action already maps to a translated string ("provider_busy" or
 * "analysis_failed"), so callers can just hand it on. */
export class ProviderError extends Error {}

// Both Gemini and Anthropic occasionally reject a request with a transient
// "the model is overloaded, try again" (Gemini: 503 UNAVAILABLE; Anthropic:
// 529 overloaded_error) or plain rate limiting (429) rather than a real
// failure. A busy response moves on to the *next attempt in the chain* (a
// different model or provider, a different capacity pool) instead of
// hammering the same overloaded one twice, which both wastes shared deadline
// budget and, per Google's own guidance for the 503 case, is less effective
// than trying something different.
export const RETRYABLE_STATUS = new Set([429, 503, 529]);

// An attempt is only worth starting if there's realistically enough of the
// shared deadline left for it to complete — a slow attempt (rather than a
// fast overload rejection) can leave too little time for another to do
// anything but get aborted mid-flight, which is exactly what surfaced as a
// raw AbortError instead of a sensible message before this check existed.
export const MIN_ATTEMPT_BUDGET_MS = 15_000;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Both "-latest" values are Google-maintained aliases that always resolve
// to the current stable release of that tier, so neither needs bumping by
// hand as new Gemini versions ship. Flash-Lite is a genuinely separate,
// smaller model — its own capacity pool, not just a renamed Flash — which
// is what makes it worth trying when Flash itself reports overloaded,
// rather than just being another name for the same busy backend.
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export type Attempt =
  | { label: string; kind: "gemini"; apiKey: string; model: string }
  | { label: string; kind: "anthropic"; apiKey: string; model: string };

/** Builds the ordered attempt chain: Gemini's primary model, then (when
 * `geminiFallbackModel` is on) Gemini's fallback model — skipped if it
 * resolves to the same model id as the primary, e.g. both env vars pointing
 * at the same pin — then Anthropic, each only included when its provider's
 * key is set. With both keys set, Anthropic is a genuine mid-call fallback
 * for a busy Gemini, not just a fallback for GEMINI_API_KEY being entirely
 * unset — a real (if small) cost documented in .env.example next to
 * ANTHROPIC_API_KEY. */
export function resolveAttempts(options: { anthropicModel: string; geminiFallbackModel: boolean }): Attempt[] {
  const attempts: Attempt[] = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const primaryModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    attempts.push({ label: `gemini:${primaryModel}`, kind: "gemini", apiKey: geminiKey, model: primaryModel });
    if (options.geminiFallbackModel) {
      const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_GEMINI_FALLBACK_MODEL;
      if (fallbackModel !== primaryModel) {
        attempts.push({ label: `gemini:${fallbackModel}`, kind: "gemini", apiKey: geminiKey, model: fallbackModel });
      }
    }
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    attempts.push({ label: "anthropic", kind: "anthropic", apiKey: anthropicKey, model: options.anthropicModel });
  }

  return attempts;
}

export type ChainRequest<T> = {
  /** Used in log messages, e.g. "AI shelf scan". */
  feature: string;
  systemPrompt: string;
  /** The user turn's text, sent after the image when there is one. */
  userText: string;
  image?: { mediaType: string; base64Data: string };
  /** The answer's shape in Gemini's responseSchema dialect. */
  geminiSchema: unknown;
  /** The same shape as an Anthropic tool; the model is forced to call it. */
  anthropicTool: { name: string; description: string; input_schema: unknown };
  anthropicMaxTokens: number;
  /** Validates the model's JSON (from either provider). */
  schema: z.ZodType<T>;
  /** Shared across every attempt in the chain. */
  timeoutMs: number;
  /** "busy" (the scans): move on only for a busy provider with deadline
   * left, since a real analysis failure is a bug worth seeing. "any" (the
   * best-effort category fallback): any failed attempt moves on. */
  fallbackOn: "busy" | "any";
  /** Level for a failed request/parse. The user-facing scans log errors;
   * the background category fallback only warns. */
  failureLevel: "error" | "warn";
};

export type ChainResult<T> = { ok: true; data: T } | { ok: false; error: string };

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

type AnthropicContentBlock = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };
type AnthropicResponse = { content?: AnthropicContentBlock[]; error?: { message?: string } };

async function callGemini<T>(
  attempt: Extract<Attempt, { kind: "gemini" }>,
  req: ChainRequest<T>,
  signal: AbortSignal,
): Promise<T> {
  const { model } = attempt;
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": attempt.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            ...(req.image ? [{ inlineData: { mimeType: req.image.mediaType, data: req.image.base64Data } }] : []),
            { text: req.userText },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", responseSchema: req.geminiSchema },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as GeminiResponse | null;
    logger[req.failureLevel](`${req.feature} (Gemini) request failed`, {
      model,
      status: response.status,
      message: body?.error?.message,
    });
    throw new ProviderError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new ProviderError("analysis_failed");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    logger[req.failureLevel](`${req.feature} (Gemini) returned non-JSON text`, { model, text: excerptForLog(text) });
    throw new ProviderError("analysis_failed");
  }

  const parsed = req.schema.safeParse(json);
  if (!parsed.success) {
    logger[req.failureLevel](`${req.feature} (Gemini) returned an unexpected shape`, { model, issues: parsed.error.issues });
    throw new ProviderError("analysis_failed");
  }
  return parsed.data;
}

async function callAnthropic<T>(
  attempt: Extract<Attempt, { kind: "anthropic" }>,
  req: ChainRequest<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": attempt.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: attempt.model,
      max_tokens: req.anthropicMaxTokens,
      system: req.systemPrompt,
      tools: [req.anthropicTool],
      tool_choice: { type: "tool", name: req.anthropicTool.name },
      messages: [
        {
          role: "user",
          // A text-only call (no image) sends the bare string, as the
          // category fallback always has.
          content: req.image
            ? [
                { type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64Data } },
                { type: "text", text: req.userText },
              ]
            : req.userText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AnthropicResponse | null;
    logger[req.failureLevel](`${req.feature} (Anthropic) request failed`, {
      status: response.status,
      message: body?.error?.message,
    });
    throw new ProviderError(RETRYABLE_STATUS.has(response.status) ? "provider_busy" : "analysis_failed");
  }

  const data = (await response.json()) as AnthropicResponse;
  const toolUse = data.content?.find(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) throw new ProviderError("analysis_failed");

  const parsed = req.schema.safeParse(toolUse.input);
  if (!parsed.success) {
    logger[req.failureLevel](`${req.feature} (Anthropic) returned an unexpected shape`, { issues: parsed.error.issues });
    throw new ProviderError("analysis_failed");
  }
  return parsed.data;
}

/** Walks `attempts` in order under one shared deadline and returns the first
 * success, or the error code of the failure that ended the walk
 * ("provider_busy" or "analysis_failed"). `attempts` must be non-empty;
 * callers check for "not configured" themselves. Never throws. */
export async function runProviderChain<T>(attempts: Attempt[], req: ChainRequest<T>): Promise<ChainResult<T>> {
  const deadlineAt = Date.now() + req.timeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs);

  try {
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const next = attempts[i + 1];
      try {
        const data =
          attempt.kind === "gemini"
            ? await callGemini(attempt, req, controller.signal)
            : await callAnthropic(attempt, req, controller.signal);
        return { ok: true, data };
      } catch (error) {
        if (req.fallbackOn === "any") {
          logger.warn(`${req.feature} (${attempt.label}) attempt failed`, {
            error: error instanceof Error ? error.message : error,
          });
          continue;
        }

        const hasTime = deadlineAt - Date.now() > MIN_ATTEMPT_BUDGET_MS;
        if (error instanceof ProviderError) {
          if (error.message === "provider_busy" && next && hasTime) {
            logger.warn(`${req.feature}: ${attempt.label} busy, falling back to ${next.label}`);
            continue;
          }
          return { ok: false, error: error.message };
        }
        // The shared timeout firing mid-request surfaces here as a plain
        // AbortError, not a ProviderError — the deadline is spent either
        // way, so there's no point trying anything else; report it as the
        // same "busy, try again" case as a provider overload rather than
        // the generic failure message, since that's what it is from the
        // user's side.
        if (error instanceof Error && error.name === "AbortError") {
          logger.error(`${req.feature} (${attempt.label}) timed out`, { error });
          return { ok: false, error: "provider_busy" };
        }
        logger.error(`${req.feature} (${attempt.label}) request errored`, { error });
        return { ok: false, error: "analysis_failed" };
      }
    }
    return { ok: false, error: "analysis_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
