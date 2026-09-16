"use server";

// AI shelf scan (beta) — src/components/inventory/ai-shelf-scan-dialog.tsx.
// Takes a photo of a shelf/fridge/cupboard and asks Claude's vision API to
// guess what's in it, following the same "AI suggests, human confirms"
// shape as the barcode lookup (src/lib/actions/barcode.ts) and receipt scan
// (src/lib/receipt-parsing.ts): nothing here ever writes to the database —
// the dialog feeds the guesses into bulkCreateInventoryItemsAction (see
// src/app/dashboard/inventory/actions.ts) only after the user reviews and
// confirms them.
//
// Unlike the barcode scanner and receipt OCR (both fully client-side, photo
// never leaves the device), this genuinely uploads the photo to Anthropic's
// API — there's no client-side vision model to run this against instead.
// The dialog discloses that before the camera opens.

import { z } from "zod";
import { requireHousehold } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 30_000;

// A household doing a full pantry audit might scan several shelves in one
// sitting — generous enough for that, tight enough that a buggy client
// (or a misuse) can't run up an unbounded API bill.
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

const toolResultSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
        quantity: z.coerce.number().positive().max(999).default(1),
      }),
    )
    .max(MAX_ITEMS_PER_SCAN),
});

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

const SYSTEM_PROMPT =
  "You are helping someone take inventory of their kitchen by photographing a shelf, fridge, or cupboard. " +
  "Identify each distinct item visible and estimate how many of each there are. Group identical items into " +
  "one entry with a combined quantity rather than listing them one by one. Skip anything that clearly isn't " +
  "food or a household product (people, furniture, walls). If you can't tell exactly what something is, use " +
  "a generic descriptive name rather than inventing a specific brand or flavor. Call report_shelf_items with " +
  "your findings, even if it's just one or two items — never leave it empty if anything identifiable is visible.";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
  error?: { message?: string };
};

/** Takes a client-captured photo (as a data URL) and returns Claude's best
 * guess at the grocery/household items visible in it. Every guess is a
 * starting point for the review step in ai-shelf-scan-dialog.tsx, never
 * written to the database directly. */
export async function scanShelfPhotoAction(photoDataUrl: string): Promise<ScanShelfPhotoResult> {
  const { household } = await requireHousehold();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { error: "not_configured" };
  }

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: process.env.INVENTORY_SCAN_MODEL || DEFAULT_MODEL,
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
      logger.error("AI shelf scan request failed", { status: response.status, message: body?.error?.message });
      return { error: "analysis_failed" };
    }

    const data = (await response.json()) as AnthropicResponse;
    const toolUse = data.content?.find(
      (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use",
    );
    if (!toolUse) return { error: "analysis_failed" };

    const parsed = toolResultSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      logger.error("AI shelf scan returned an unexpected shape", { issues: parsed.error.issues });
      return { error: "analysis_failed" };
    }

    return { items: parsed.data.items };
  } catch (error) {
    logger.error("AI shelf scan request errored", { error });
    return { error: "analysis_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
