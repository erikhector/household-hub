import { tagsFromSchemaOrgDiet, type RecipeTag } from "@/lib/recipe-tags";
import { parseIngredientLine } from "./parse-ingredient";
import type { ParsedRecipe } from "./types";

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
    .flatMap(parseIngredientLine);

  const instructions = flattenInstructions(node.recipeInstructions);

  return { name, instructions, ingredients };
}

export function hasAnyContent(recipe: ParsedRecipe): boolean {
  return Boolean(recipe.name || recipe.ingredients.length > 0 || recipe.instructions);
}

export function parseJsonLdRecipe(html: string): (ParsedRecipe & { tags: RecipeTag[] }) | null {
  const node = findRecipeNode(extractJsonLdBlocks(html));
  if (!node) return null;
  const recipe = mapJsonLdToRecipe(node);
  return hasAnyContent(recipe) ? { ...recipe, tags: tagsFromSchemaOrgDiet(node.suitableForDiet) } : null;
}

