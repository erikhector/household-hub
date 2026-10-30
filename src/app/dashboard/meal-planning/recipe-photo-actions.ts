"use server";

// Recipe import from a photo (GAP-54) — the "Import from a photo" button in
// RecipeFormDialog (src/components/meal-planning/recipe-form-dialog.tsx),
// beside the URL import. Takes a client-resized photo of a cookbook page or
// recipe card (as a data URL) and asks a vision model for the title,
// ingredient lines and method, to pre-fill the same form state the URL
// import fills.
//
// Same stance as importRecipeFromUrlAction: it never saves anything — the
// user reviews and edits, then submits the normal create/update action. And
// the same provider chain, privacy tradeoff and rate-limit shape as the
// receipt scan (src/lib/actions/receipt-scan.ts): the photo is uploaded to
// the configured third-party vision API and never stored. There is no
// Tesseract fallback here (that one is receipt-specific), so with neither
// GEMINI_API_KEY nor ANTHROPIC_API_KEY set the button is hidden
// (the meal-planning page checks the same two keys) and a direct call
// answers "not configured".

import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { checkRateLimit } from "@/lib/rate-limit";
import { DEFAULT_ANTHROPIC_MODEL, resolveAttempts, runProviderChain } from "@/lib/ai/provider-chain";
import {
  mapPhotoRecipe,
  RECIPE_PHOTO_GEMINI_SCHEMA,
  RECIPE_PHOTO_SYSTEM_PROMPT,
  RECIPE_PHOTO_TOOL,
  RECIPE_PHOTO_USER_TEXT,
  recipePhotoSchema,
} from "@/lib/recipe-import/photo";
import type { ParsedRecipe } from "@/lib/recipe-import";

// Same shared-deadline reasoning as REQUEST_TIMEOUT_MS in receipt-scan.ts.
const REQUEST_TIMEOUT_MS = 50_000;

// Rate-limited separately from the receipt scan (its own key), same numbers.
const RECIPE_PHOTO_RATE_LIMIT = 20;
const RECIPE_PHOTO_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Same ceiling as the receipt scan: far above a client-resized photo
// (src/lib/image-resize.ts), it only guards against a request that skips
// the resize.
const MAX_BASE64_LENGTH = 6_000_000;
const DATA_URL_RE = /^data:([\w./+-]+);base64,([\s\S]+)$/;

export type ImportRecipeFromPhotoResult = { recipe?: ParsedRecipe; error?: string };

function photoAttempts() {
  return resolveAttempts({
    anthropicModel: process.env.RECEIPT_SCAN_MODEL || DEFAULT_ANTHROPIC_MODEL,
    geminiFallbackModel: true,
  });
}

export async function importRecipeFromPhotoAction(photoDataUrl: string): Promise<ImportRecipeFromPhotoResult> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).mealPlanning;

  const attempts = photoAttempts();
  if (attempts.length === 0) return { error: dict.importPhotoErrorNotConfigured };

  if (
    !(await checkRateLimit(
      `recipe-photo-import:${household.id}`,
      RECIPE_PHOTO_RATE_LIMIT,
      RECIPE_PHOTO_RATE_LIMIT_WINDOW_MS,
    ))
  ) {
    return { error: dict.importErrorRateLimited };
  }

  if (typeof photoDataUrl !== "string" || photoDataUrl.length > MAX_BASE64_LENGTH) {
    return { error: dict.importPhotoErrorInvalid };
  }
  const match = photoDataUrl.match(DATA_URL_RE);
  if (!match) return { error: dict.importPhotoErrorInvalid };
  const [, mediaType, base64Data] = match;
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) return { error: dict.importPhotoErrorInvalid };

  const result = await runProviderChain(attempts, {
    feature: "AI recipe photo import",
    systemPrompt: RECIPE_PHOTO_SYSTEM_PROMPT,
    userText: RECIPE_PHOTO_USER_TEXT,
    image: { mediaType, base64Data },
    geminiSchema: RECIPE_PHOTO_GEMINI_SCHEMA,
    anthropicTool: RECIPE_PHOTO_TOOL,
    anthropicMaxTokens: 4096,
    schema: recipePhotoSchema,
    timeoutMs: REQUEST_TIMEOUT_MS,
    fallbackOn: "busy",
    failureLevel: "error",
  });
  if (!result.ok) {
    return { error: result.error === "provider_busy" ? dict.importPhotoErrorBusy : dict.importPhotoErrorFailed };
  }

  const recipe = mapPhotoRecipe(result.data);
  if (!recipe) return { error: dict.importPhotoErrorNoRecipe };
  return { recipe };
}
