import { gunzipSync, inflateRawSync } from "node:zlib";
import { tagsFromSchemaOrgDiet, type RecipeTag } from "@/lib/recipe-tags";
import { flattenInstructions, mapJsonLdToRecipe } from "./parse-jsonld";
import { parseIngredientLine } from "./parse-ingredient";
import type { ParsedIngredient, ParsedRecipe } from "./types";

// GAP-67: recipes from a file instead of a URL. Two inputs, told apart by
// their first bytes rather than the file name (a renamed download still
// works):
//   - a `.paprikarecipes` export: a zip with one entry per recipe, each entry
//     the gzip of a small JSON object (Paprika's own field names: `name`,
//     `ingredients` as one newline-separated string, `directions`, `notes`,
//     `servings` as free text, `categories`);
//   - plain schema.org Recipe JSON-LD / `.json`: one Recipe object, an array
//     of them, or a `@graph`.
// Pure and synchronous apart from node:zlib. The caller (the server action in
// recipe-file-actions.ts) owns auth, the rate limit and what gets saved; this
// file only turns bytes into candidate recipes, never saves or fetches.
//
// The archive is untrusted input, so every limit below is enforced BEFORE the
// expensive step it guards: the byte cap before reading, the entry count
// before inflating anything, and an output ceiling on every inflate so a zip
// bomb stops at a few MB instead of filling memory.

/** The whole upload. Paprika archives with photos run a few MB for 100+ recipes. */
export const RECIPE_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** Recipes per file, counted before anything is parsed or saved. */
export const RECIPE_FILE_MAX_RECIPES = 200;
// One recipe's JSON after inflating. Paprika embeds a base64 photo in each
// entry, so this is generous, but it is the bomb guard, not a recipe limit.
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
// All entries together, so 200 entries at the per-entry ceiling still can't
// ask for 1.6 GB.
const MAX_TOTAL_INFLATED_BYTES = 64 * 1024 * 1024;

// Mirror recipe-actions.ts's recipeSchema and ingredient row bounds, so a
// recipe that came out of here always passes the same limits a hand-typed one
// does (the import action re-checks nothing it can't trust the parser for).
export const RECIPE_FILE_NAME_MAX = 120;
export const RECIPE_FILE_INSTRUCTIONS_MAX = 4000;
const MAX_INGREDIENT_ROWS = 100;
const MAX_INGREDIENT_NAME_LENGTH = 120;
const MAX_INGREDIENT_UNIT_LENGTH = 20;
const MAX_INGREDIENT_QUANTITY = 1_000_000;
const MAX_RAW_TEXT_LENGTH = 300;
const MAX_NOTE_LENGTH = 200;
const MAX_SERVINGS = 1_000;
const DEFAULT_SERVINGS = 4;

export type FileRecipe = ParsedRecipe & { servings: number; tags: RecipeTag[] };

export type RecipeFileError =
  /** Zero bytes, or nothing that looked like a recipe at all. */
  | "empty"
  | "tooLarge"
  | "tooMany"
  /** Neither a zip nor JSON. */
  | "unsupported"
  /** A valid file of a kind we read, with no usable recipe in it. */
  | "noRecipes";

export type RecipeFileResult =
  | { ok: true; recipes: FileRecipe[]; skipped: number }
  | { ok: false; error: RecipeFileError };

// ---------------------------------------------------------------------------
// Zip reading (central directory only; no zip64, no encryption)
// ---------------------------------------------------------------------------

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const GZIP_MAGIC = [0x1f, 0x8b];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

/** Entry list from the central directory, or null if it isn't a readable zip. */
function readZipDirectory(buf: Buffer): ZipEntry[] | null {
  // The end-of-central-directory record sits in the last 22 + 65535 bytes.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) return null;
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLength > buf.length) return null;
    entries.push({
      name: buf.toString("utf8", pos + 46, pos + 46 + nameLength),
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      localOffset: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** One entry's stored bytes inflated, or null when it is corrupt or too big. */
function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
  const at = entry.localOffset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== LOCAL_SIG) return null;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) return null;
  const data = buf.subarray(start, end);
  try {
    if (entry.method === 0) return data.length <= MAX_ENTRY_BYTES ? data : null;
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "4 servings", "Serves 4-6", 4, ["4", "4 servings"] → the first whole number. */
function servingsFrom(value: unknown): number {
  const text = String(Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));
  const found = Number.parseInt(text.match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(found) && found >= 1 ? Math.min(found, MAX_SERVINGS) : DEFAULT_SERVINGS;
}

function clampIngredient(row: ParsedIngredient): ParsedIngredient | null {
  const name = row.name.trim().slice(0, MAX_INGREDIENT_NAME_LENGTH).trim();
  if (!name) return null;
  const quantity =
    Number.isFinite(row.quantity) && row.quantity > 0 ? Math.min(row.quantity, MAX_INGREDIENT_QUANTITY) : 1;
  const out: ParsedIngredient = {
    name,
    quantity,
    unit: (row.unit.trim() || "pcs").slice(0, MAX_INGREDIENT_UNIT_LENGTH),
  };
  if (row.note) out.note = row.note.slice(0, MAX_NOTE_LENGTH);
  if (row.rawText) out.rawText = row.rawText.slice(0, MAX_RAW_TEXT_LENGTH);
  return out;
}

/** Applies the stored-recipe bounds; null when nothing usable is left. */
function finish(
  name: string,
  instructions: string,
  ingredients: ParsedIngredient[],
  servings: number,
  tags: RecipeTag[],
): FileRecipe | null {
  const cleanName = name.trim().slice(0, RECIPE_FILE_NAME_MAX).trim();
  if (!cleanName) return null;
  const rows: ParsedIngredient[] = [];
  for (const row of ingredients) {
    const clamped = clampIngredient(row);
    if (clamped) rows.push(clamped);
    if (rows.length === MAX_INGREDIENT_ROWS) break;
  }
  return {
    name: cleanName,
    instructions: instructions.trim().slice(0, RECIPE_FILE_INSTRUCTIONS_MAX),
    ingredients: rows,
    servings,
    tags,
  };
}

// ---------------------------------------------------------------------------
// The two recipe shapes
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecipeNode(node: JsonObject): boolean {
  const type = node["@type"];
  return type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
}

/** One Paprika entry (`ingredients` is a single newline-separated string). */
export function mapPaprikaRecipe(entry: JsonObject): FileRecipe | null {
  const ingredients = str(entry.ingredients)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(parseIngredientLine);
  // Paprika keeps its own notes in a separate field; nothing in Squirrel's
  // recipe has a notes box, so they ride along under the method rather than
  // being dropped.
  const directions = str(entry.directions);
  const notes = str(entry.notes);
  const instructions = notes ? (directions ? `${directions}\n\n${notes}` : notes) : directions;
  // Paprika's categories are the user's own free text ("Dinner"), not a diet
  // claim, so they are not mapped onto tags.
  return finish(str(entry.name), instructions, ingredients, servingsFrom(entry.servings), []);
}

/** One schema.org Recipe object. */
export function mapSchemaRecipe(node: JsonObject): FileRecipe | null {
  const mapped = mapJsonLdToRecipe(node);
  return finish(
    mapped.name,
    flattenInstructions(node.recipeInstructions),
    mapped.ingredients,
    servingsFrom(node.recipeYield),
    tagsFromSchemaOrgDiet(node.suitableForDiet),
  );
}

function mapAnyRecipe(value: unknown): FileRecipe | null {
  if (!isObject(value)) return null;
  return isRecipeNode(value) ? mapSchemaRecipe(value) : mapPaprikaRecipe(value);
}

/** Every Recipe node in a JSON-LD document: a node, an array, or a `@graph`. */
function collectSchemaRecipes(value: unknown, depth = 0): JsonObject[] {
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectSchemaRecipes(item, depth + 1));
  if (!isObject(value)) return [];
  if (isRecipeNode(value)) return [value];
  return Array.isArray(value["@graph"]) ? collectSchemaRecipes(value["@graph"], depth + 1) : [];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function decodeJson(bytes: Uint8Array): unknown {
  const text = Buffer.from(bytes).toString("utf8").replace(/^﻿/, "");
  return JSON.parse(text);
}

function parseArchive(buf: Buffer): RecipeFileResult {
  const directory = readZipDirectory(buf);
  if (!directory) return { ok: false, error: "unsupported" };
  const entries = directory.filter(
    (entry) => !entry.name.endsWith("/") && !entry.name.startsWith("__MACOSX/") && !entry.name.split("/").pop()!.startsWith("."),
  );
  if (entries.length === 0) return { ok: false, error: "empty" };
  if (entries.length > RECIPE_FILE_MAX_RECIPES) return { ok: false, error: "tooMany" };

  const recipes: FileRecipe[] = [];
  let skipped = 0;
  let inflated = 0;
  for (const entry of entries) {
    const raw = readZipEntry(buf, entry);
    if (!raw) {
      skipped++;
      continue;
    }
    inflated += raw.length;
    if (inflated > MAX_TOTAL_INFLATED_BYTES) return { ok: false, error: "tooLarge" };
    try {
      // Paprika gzips each recipe; a plain-JSON entry is accepted too.
      const json = startsWith(raw, GZIP_MAGIC) ? gunzipSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : raw;
      const recipe = mapAnyRecipe(decodeJson(json));
      if (recipe) recipes.push(recipe);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return recipes.length > 0 ? { ok: true, recipes, skipped } : { ok: false, error: "noRecipes" };
}

// A Recipe node stays itself, a `@graph` yields the Recipe nodes inside it, and
// anything else is handed on as it is (a Paprika-shaped object).
function expandNode(node: JsonObject): JsonObject[] {
  if (isRecipeNode(node)) return [node];
  return Array.isArray(node["@graph"]) ? collectSchemaRecipes(node["@graph"]) : [node];
}

function parseJsonFile(bytes: Buffer): RecipeFileResult {
  let parsed: unknown;
  try {
    parsed = decodeJson(bytes);
  } catch {
    return { ok: false, error: "unsupported" };
  }
  const candidates = Array.isArray(parsed)
    ? parsed.filter(isObject).flatMap(expandNode)
    : isObject(parsed)
      ? expandNode(parsed)
      : [];
  if (candidates.length > RECIPE_FILE_MAX_RECIPES) return { ok: false, error: "tooMany" };
  const recipes: FileRecipe[] = [];
  let skipped = 0;
  for (const node of candidates) {
    const recipe = mapAnyRecipe(node);
    if (recipe) recipes.push(recipe);
    else skipped++;
  }
  return recipes.length > 0 ? { ok: true, recipes, skipped } : { ok: false, error: "noRecipes" };
}

/**
 * Reads a recipe file's bytes into candidate recipes. `skipped` counts
 * entries that were corrupt, unreadable or had no name; they never fail the
 * whole file. Nothing here saves anything.
 */
export function parseRecipeFile(input: Uint8Array): RecipeFileResult {
  if (input.length === 0) return { ok: false, error: "empty" };
  if (input.length > RECIPE_FILE_MAX_BYTES) return { ok: false, error: "tooLarge" };
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return startsWith(buf, ZIP_MAGIC) ? parseArchive(buf) : parseJsonFile(buf);
}
