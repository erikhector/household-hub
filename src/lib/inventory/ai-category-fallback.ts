// AUTO-2b(a) — the optional AI tier behind AUTO-2's deterministic
// auto-categorization (src/lib/inventory/auto-category.ts,
// category-resolver.ts): household memory and the bilingual dictionary
// already cover the large majority of grocery/household item names without
// ever calling out to a model. This module is only reached once *both* of
// those have already missed and a provider key happens to be configured —
// see the "Works with no AI key configured" guardrail in BACKLOG.md, which
// this mirrors from src/lib/actions/inventory-scan.ts: same
// GEMINI_API_KEY/GEMINI_MODEL/ANTHROPIC_API_KEY env vars (see .env.example),
// Gemini tried first for its free tier, Anthropic as the fallback, nothing
// configured means this is a silent no-op.
//
// Unlike AI shelf scan and AI receipt scan, this never sends a photo — only
// the bare item *names* that missed the deterministic resolver, batched
// into one classification call per add (never one call per item), per the
// "any new AI call sends the minimum data needed (item names only)"
// guardrail. There's no household context, no quantities, no prices in the
// prompt at all.
//
// scheduleAiCategoryFallback (category-resolver.ts) is the only caller:
// it's invoked from inside `after()` (next/server), once the item has
// *already* been committed as "Uncategorized" — this module never blocks
// an add and never throws past its own boundary. A model that's slow,
// errors, or returns something outside AUTO_CATEGORY_KEYS just leaves
// every item exactly as it already was.

import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { AUTO_CATEGORY_KEYS, type AutoCategoryKey } from "@/lib/inventory/auto-category";

// Same household-scoped budget as AI shelf scan / AI receipt scan
// (SCAN_RATE_LIMIT / RECEIPT_SCAN_RATE_LIMIT in src/lib/actions/
// inventory-scan.ts / receipt-scan.ts) — this call is far cheaper (one
// short text prompt, no image) but there's no reason a household would
// legitimately need a bigger budget than either of those.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// One classification call per add batch, not per item — but still bounded,
// so a large paste/scan session (bulkCreateInventoryItemsAction caps at
// 300 rows) can't turn into one unbounded prompt.
const MAX_NAMES_PER_CALL = 50;
const NAME_MAX_LENGTH = 120;

// Generous enough for a short text completion, nowhere near
// inventory-scan.ts's 50s (that one waits on image tokens); this is a
// background patch, not something a user is staring at a spinner for, so
// erring toward "give up and leave it Uncategorized" over "hold the
// request context open" is the right tradeoff.
const REQUEST_TIMEOUT_MS = 20_000;

// What the model answers when none of AUTO_CATEGORY_KEYS clearly fits —
// the "already-not-found" sentinel the backlog item calls for, so a
// deliberate "I don't know" is distinguishable from a parse failure.
const UNKNOWN_SENTINEL = "unknown";

const SYSTEM_PROMPT =
  "You will be given a JSON array of short grocery/household item names. For each one, in the same " +
  `order, answer with exactly one of these category keys: ${AUTO_CATEGORY_KEYS.join(", ")}. ` +
  `If none of them clearly fits, answer "${UNKNOWN_SENTINEL}" for that item instead — never invent a ` +
  "category outside this list. Respond with exactly one category per input name.";

// Deliberately z.string(), not z.enum(AUTO_CATEGORY_KEYS) — a single
// hallucinated value must not fail Zod parsing for the *whole* response and
// throw away every other item's perfectly good answer. toKey (below)
// clamps each entry individually instead, so only that one item is left
// unresolved.
const classifyResponseSchema = z.object({
  categories: z.array(z.string()).max(MAX_NAMES_PER_CALL),
});

/** Clamps a single raw model answer to a real AutoCategoryKey, or null for
 * anything else (the sentinel, a hallucinated value, a missing entry). */
function toKey(value: string | undefined): AutoCategoryKey | null {
  return value && (AUTO_CATEGORY_KEYS as readonly string[]).includes(value) ? (value as AutoCategoryKey) : null;
}

// ---------------------------------------------------------------------------
// Gemini — same REST endpoint and responseSchema-constrained JSON approach
// as callGemini in inventory-scan.ts, minus the image part.
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Mirrors inventory-scan.ts's DEFAULT_GEMINI_MODEL — kept as its own literal
// here rather than importing it, since inventory-scan.ts doesn't export it
// and this call has nothing else in common with the vision path.
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

const GEMINI_CATEGORIES_SCHEMA = {
  type: "OBJECT",
  properties: {
    categories: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: `One of ${AUTO_CATEGORY_KEYS.join(", ")}, or "${UNKNOWN_SENTINEL}" — one entry per input name, in the same order.`,
    },
  },
  required: ["categories"],
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

async function callGemini(apiKey: string, model: string, names: string[], signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(names) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: GEMINI_CATEGORIES_SCHEMA },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as GeminiResponse | null;
    logger.warn("AI category fallback (Gemini) request failed", { model, status: response.status, message: body?.error?.message });
    throw new Error("gemini_request_failed");
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new Error("gemini_empty_response");

  const parsed = classifyResponseSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("gemini_unexpected_shape");
  return parsed.data.categories;
}

// ---------------------------------------------------------------------------
// Anthropic — same forced tool-use approach as callAnthropic in
// inventory-scan.ts, minus the image content block.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// A plain text classification task needs none of the vision capability
// INVENTORY_SCAN_MODEL exists to override, so this isn't made configurable
// separately — one fewer env var to document for a background feature this
// small.
const ANTHROPIC_MODEL = "claude-sonnet-5";

const CLASSIFY_TOOL = {
  name: "report_categories",
  description: "Report one category per input item name, in the same order.",
  input_schema: {
    type: "object" as const,
    properties: {
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: [...AUTO_CATEGORY_KEYS, UNKNOWN_SENTINEL],
        },
      },
    },
    required: ["categories"],
  },
};

type AnthropicContentBlock = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };
type AnthropicResponse = { content?: AnthropicContentBlock[]; error?: { message?: string } };

async function callAnthropic(apiKey: string, names: string[], signal: AbortSignal): Promise<string[]> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: CLASSIFY_TOOL.name },
      messages: [{ role: "user", content: JSON.stringify(names) }],
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AnthropicResponse | null;
    logger.warn("AI category fallback (Anthropic) request failed", { status: response.status, message: body?.error?.message });
    throw new Error("anthropic_request_failed");
  }

  const data = (await response.json()) as AnthropicResponse;
  const toolUse = data.content?.find(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use",
  );
  if (!toolUse) throw new Error("anthropic_empty_response");

  const parsed = classifyResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) throw new Error("anthropic_unexpected_shape");
  return parsed.data.categories;
}

// ---------------------------------------------------------------------------

type Attempt = { kind: "gemini"; apiKey: string; model: string } | { kind: "anthropic"; apiKey: string };

/** Gemini first (its free tier makes this genuinely free to run), then
 * Anthropic — same provider order as inventory-scan.ts's resolveAttempts,
 * skipping whichever provider has no key set. No same-provider retry chain
 * here (unlike inventory-scan.ts's busy-status fallback): this call is
 * best-effort and cheap enough that a single miss just means the item stays
 * "Uncategorized", exactly as if no key were configured at all. */
function resolveAttempts(): Attempt[] {
  const attempts: Attempt[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) attempts.push({ kind: "gemini", apiKey: geminiKey, model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) attempts.push({ kind: "anthropic", apiKey: anthropicKey });
  return attempts;
}

/** Whether this tier can run at all — mirrors inventory-scan.ts's own
 * "attempts.length === 0" keyless check, reusing the exact same env vars
 * rather than inventing a separate on/off switch for this feature. */
export function isAiCategoryFallbackConfigured(): boolean {
  return resolveAttempts().length > 0;
}

function callAttempt(attempt: Attempt, names: string[], signal: AbortSignal): Promise<string[]> {
  return attempt.kind === "gemini"
    ? callGemini(attempt.apiKey, attempt.model, names, signal)
    : callAnthropic(attempt.apiKey, names, signal);
}

/**
 * Batches `names` into one small classification call and returns a
 * `name -> AutoCategoryKey` map for whichever ones the model confidently
 * placed in one of AUTO_CATEGORY_KEYS. Always resolves — never rejects —
 * so a caller can treat "nothing came back" (no key configured, rate
 * limited, every provider failed, a blank/oversized input) exactly the
 * same as "the model didn't recognize any of these": leave them as they
 * are. Names not present as a key in the returned map simply weren't
 * resolved.
 */
export async function resolveCategoriesWithAiFallback(
  householdId: string,
  names: readonly string[],
): Promise<Map<string, AutoCategoryKey>> {
  const result = new Map<string, AutoCategoryKey>();

  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .slice(0, MAX_NAMES_PER_CALL)
    .map((name) => name.slice(0, NAME_MAX_LENGTH));
  if (unique.length === 0) return result;

  const attempts = resolveAttempts();
  if (attempts.length === 0) return result; // no key configured — keyless path stays untouched

  // Rate-limited per household, same as AI shelf scan / AI receipt scan.
  // Checked *after* confirming a key exists, so an unconfigured deployment
  // never spends any of a household's budget on a call it was never going
  // to make.
  if (!(await checkRateLimit(`ai-category-fallback:${householdId}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS))) {
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (const attempt of attempts) {
      try {
        const raw = await callAttempt(attempt, unique, controller.signal);
        unique.forEach((name, i) => {
          const key = toKey(raw[i]);
          if (key) result.set(name, key);
        });
        return result;
      } catch (error) {
        logger.warn(`AI category fallback (${attempt.kind}) attempt failed`, {
          error: error instanceof Error ? error.message : error,
        });
        // Falls through to the next attempt (if any); every provider
        // failing just means the loop ends with an empty result below.
      }
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
