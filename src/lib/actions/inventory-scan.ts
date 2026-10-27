"use server";

// AI shelf scan (beta) — src/components/inventory/ai-shelf-scan-dialog.tsx.
// Takes a photo of a shelf/fridge/cupboard and asks a vision model to guess
// what's in it, following the same "AI suggests, human confirms" shape as
// the barcode lookup (src/lib/actions/barcode.ts) and receipt scan
// (src/lib/receipt-parsing.ts): nothing here ever writes to the database —
// the dialog feeds the guesses into bulkCreateInventoryItemsAction or
// bulkSetInventoryQuantitiesAction (see src/app/dashboard/inventory/actions.ts)
// only after the user reviews and confirms them.
//
// Unlike the barcode scanner and receipt OCR (both fully client-side, photo
// never leaves the device), this genuinely uploads the photo to a
// third-party API — there's no client-side vision model to run this against
// instead. The dialog discloses that before the camera opens.
//
// An ordered chain of attempts, built by resolveAttempts (src/lib/ai/provider-chain.ts) — Gemini's primary
// model, then Gemini's fallback model, then Anthropic, skipping whichever
// provider has no key set. Gemini goes first because its free tier
// (generativelanguage.googleapis.com, no card required) makes this feature
// genuinely free to run for a single household, where Anthropic's is
// metered from the first request. runProviderChain walks the chain and
// moves to the next entry only when the current one reports itself busy —
// Google's own guidance for an overloaded model is to try a different one
// (a different model is a different capacity pool), so that's tried before
// spending real money falling through to Anthropic.
//
// Two modes, chosen by the dialog's mode toggle:
// - "add": the default — every identified item is a candidate to create.
// - "restock" ("Take stock"): for a household doing a walkthrough recount
//   rather than a first-time cupboard fill. The household's current item
//   names are included in the prompt and the model is asked to line up
//   each thing it sees against one of them (matchedExistingItem below) —
//   resolveMatches then turns a confident match back into a real item id
//   so the dialog can offer to *set* that item's quantity to what was just
//   counted, instead of creating a duplicate row.

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_ANTHROPIC_MODEL, resolveAttempts, runProviderChain } from "@/lib/ai/provider-chain";

// A live test against Gemini's free-tier gemini-flash-latest took ~41s for
// one successful call (thinking + image tokens both add latency there) —
// comfortably past a shorter timeout, which would abort a call that was
// actually going to succeed. Shared as one deadline across every attempt in
// the chain (see runProviderChain) — kept a bit under the inventory
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

export type ScanShelfMode = "add" | "restock";

export type ScannedShelfItem = {
  name: string;
  quantity: number;
  /** Set only in "restock" mode, and only when resolveMatches found a
   * confident, real household item for the model's matchedExistingItem
   * guess — see the mode comment at the top of this file. */
  matchedItemId?: string;
  matchedItemName?: string;
  previousQuantity?: number;
  previousUnit?: string;
};
export type ScanShelfPhotoResult = { items?: ScannedShelfItem[]; error?: string };

// What the model itself reports — matchedExistingItem is a free-text guess
// at one of the existingNames passed into buildSystemPrompt, not yet a
// verified item id. resolveMatches (below) is what turns this into a real
// ScannedShelfItem, so a hallucinated name that isn't actually in the
// household's inventory just falls back to being treated as a new item.
const rawScannedItemSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX_LENGTH),
  quantity: z.coerce.number().positive().max(999).default(1),
  matchedExistingItem: z.string().trim().min(1).max(NAME_MAX_LENGTH).nullable().optional(),
});
type RawScannedItem = z.infer<typeof rawScannedItemSchema>;

const shelfItemsSchema = z.object({
  items: z.array(rawScannedItemSchema).max(MAX_ITEMS_PER_SCAN),
});

// Sent in the prompt for "restock" mode only — bounds token cost and, more
// importantly, keeps a household with a large inventory from blowing past a
// model's context window. Alphabetical (not, say, most-recently-updated) so
// which items make the cut is at least predictable.
const MAX_EXISTING_ITEMS_IN_PROMPT = 300;

const BASE_SYSTEM_PROMPT =
  "You are helping someone take inventory of their kitchen by photographing a shelf, fridge, or cupboard. " +
  "Identify each distinct item visible and estimate how many of each there are. Only combine multiple units " +
  "into one entry with a combined quantity when they are the exact same product — different products in the " +
  "same category (e.g. different spices, different flavors, different varieties of the same brand) are " +
  "separate entries with their own name, even if they look similar or sit on the same shelf; never lump a " +
  "row of distinct products together under one generic category name and a total count. Read each item's " +
  "name directly off its label or packaging whenever the text is legible, rather than describing the category " +
  "it belongs to. Skip anything that clearly isn't food or a household product (people, furniture, walls). " +
  "Only fall back to a generic descriptive name for an item whose label you genuinely can't read or make out — " +
  "don't invent a specific brand, flavor, or variety in that case. Report your findings even if it's just one " +
  "or two items — never report nothing if anything identifiable is visible.";

/** Appends matching instructions when doing a restock scan against a
 * non-empty inventory; unchanged from the plain add-mode prompt otherwise
 * (an empty households.list means there's nothing to match against). */
function buildSystemPrompt(existingNames: string[]): string {
  if (existingNames.length === 0) return BASE_SYSTEM_PROMPT;
  return (
    BASE_SYSTEM_PROMPT +
    " The household's current inventory already includes these items: " +
    existingNames.join(", ") +
    ". For each item you identify in the photo, if it clearly is one of the items in that list — even if " +
    "worded differently (e.g. 'Milk' vs 'Whole Milk 1L') — copy that list entry's name exactly into " +
    "matchedExistingItem. If it doesn't clearly match any of them, leave matchedExistingItem null so a new " +
    "item can be created instead. Never invent a matchedExistingItem name that isn't verbatim in that list."
  );
}

function exactNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Turns the model's free-text matchedExistingItem guesses into real item
 * ids, ignoring any guess that doesn't exactly (case/whitespace-insensitively)
 * match a name the household actually has — see the mode comment above. */
function resolveMatches(
  items: RawScannedItem[],
  existingByName: Map<string, { id: string; name: string; quantity: number; unit: string }>,
): ScannedShelfItem[] {
  return items.map(({ matchedExistingItem, ...item }) => {
    const match = matchedExistingItem ? existingByName.get(exactNameKey(matchedExistingItem)) : undefined;
    if (!match) return item;
    return {
      ...item,
      matchedItemId: match.id,
      matchedItemName: match.name,
      previousQuantity: match.quantity,
      previousUnit: match.unit,
    };
  });
}

// Gemini's and Anthropic's views of the same answer shape — the chain itself
// (attempt order, busy/deadline fallback, the REST calls) lives in
// src/lib/ai/provider-chain.ts.

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
              "Specific product name in Title Case, read off the label when legible (e.g. 'Ground Cumin', " +
              "'Smoked Paprika'), or a short generic description only when the label can't actually be read " +
              "(e.g. 'Canned Tomatoes'). Never merge distinct products into one category name.",
          },
          quantity: {
            type: "NUMBER",
            description: "How many separate units of this item are visible in the photo.",
          },
          matchedExistingItem: {
            type: "STRING",
            nullable: true,
            description:
              "Only set when the system prompt lists the household's existing items and this one clearly " +
              "matches one of them — copy that list entry's name exactly. Otherwise omit or leave null.",
          },
        },
        required: ["name", "quantity"],
      },
    },
  },
  required: ["items"],
};

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
                "Specific product name in Title Case, read off the label when legible (e.g. 'Ground Cumin', " +
                "'Smoked Paprika'), or a short generic description only when the label can't actually be read " +
                "(e.g. 'Canned Tomatoes'). Never merge distinct products into one category name.",
            },
            quantity: {
              type: "number",
              description: "How many separate units of this item are visible in the photo.",
            },
            matchedExistingItem: {
              type: ["string", "null"],
              description:
                "Only set when the system prompt lists the household's existing items and this one clearly " +
                "matches one of them — copy that list entry's name exactly. Otherwise omit or leave null.",
            },
          },
          required: ["name", "quantity"],
        },
      },
    },
    required: ["items"],
  },
};

/** Takes a client-captured photo (as a data URL) and returns the first
 * successful attempt's best guess at the grocery/household items visible
 * in it. Every guess is a starting point for the review step in
 * ai-shelf-scan-dialog.tsx, never written to the database directly.
 *
 * In "restock" mode (the dialog's "Take stock" toggle), the household's
 * current item names are folded into the prompt so the model can also
 * report which existing item each guess corresponds to — resolveMatches
 * turns a confident guess into a real matchedItemId/previousQuantity pair
 * the dialog can offer to overwrite instead of creating a duplicate. */
export async function scanShelfPhotoAction(
  photoDataUrl: string,
  mode: ScanShelfMode = "add",
): Promise<ScanShelfPhotoResult> {
  const { household } = await requireHousehold();

  const attempts = resolveAttempts({
    anthropicModel: process.env.INVENTORY_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
    geminiFallbackModel: true,
  });
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

  const existingItems =
    mode === "restock"
      ? await prisma.inventoryItem.findMany({
          where: { householdId: household.id },
          select: { id: true, name: true, quantity: true, unit: true },
          orderBy: { name: "asc" },
          take: MAX_EXISTING_ITEMS_IN_PROMPT,
        })
      : [];
  const existingByName = new Map(existingItems.map((item) => [exactNameKey(item.name), item]));
  const systemPrompt = buildSystemPrompt([...existingByName.values()].map((item) => item.name));

  const result = await runProviderChain(attempts, {
    feature: "AI shelf scan",
    systemPrompt,
    userText: "Here's the shelf. What's on it?",
    image: { mediaType, base64Data },
    geminiSchema: GEMINI_ITEMS_SCHEMA,
    anthropicTool: SHELF_SCAN_TOOL,
    anthropicMaxTokens: 2048,
    schema: shelfItemsSchema,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackOn: "busy",
    failureLevel: "error",
  });
  if (!result.ok) return { error: result.error };
  return { items: resolveMatches(result.data.items, existingByName) };
}
