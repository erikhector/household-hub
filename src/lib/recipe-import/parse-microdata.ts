import {
  getAttr,
  hasBooleanAttr,
  htmlToLines,
  htmlToText,
  OPEN_TAG_RE,
  pageTitle,
  sliceElement,
  type ElementSlice,
} from "./html";
import { parseIngredientLine } from "./parse-ingredient";
import { hasAnyContent } from "./parse-jsonld";
import type { ParsedRecipe } from "./types";

// ---------------------------------------------------------------------------
// Tier 2: schema.org Microdata
// ---------------------------------------------------------------------------

function isRecipeItemtype(attrs: string): boolean {
  const itemtype = getAttr(attrs, "itemtype");
  if (!itemtype) return false;
  return itemtype
    .split(/\s+/)
    .some((token) => /^https?:\/\/(?:www\.)?schema\.org\/Recipe\/?$/i.test(token));
}

/**
 * Reads a schema.org `Recipe` Microdata item out of the page. Only the
 * Recipe's *own* properties count: an `itemprop="name"` inside a nested
 * `itemscope` (the author's Person, a review, the publisher) belongs to that
 * nested item, so any property whose tag sits strictly inside a nested
 * item's element is skipped. The nested element's own opening tag is still
 * the Recipe's — that's how `<li itemprop="recipeInstructions" itemscope
 * itemtype=".../HowToStep">` is picked up, with its full text as the step.
 */
const MICRODATA_MAX_TAGS = 1_000;
// A nested item (a review, the author) or a single property's element is
// small; the Recipe root itself still gets the whole page.
const MICRODATA_ELEMENT_SCAN_LIMIT = 50_000;

export function parseMicrodataRecipe(html: string): ParsedRecipe | null {
  let root: ElementSlice | null = null;
  for (const match of html.matchAll(OPEN_TAG_RE)) {
    if (hasBooleanAttr(match[2], "itemscope") && isRecipeItemtype(match[2])) {
      root = sliceElement(html, match.index, html.length);
      break;
    }
  }
  if (!root) return null;

  const scope = root.inner;
  const nestedRanges: Array<[number, number]> = [];
  const props: Array<{ names: string[]; index: number; attrs: string }> = [];
  for (const match of scope.matchAll(OPEN_TAG_RE)) {
    // Bounded work on hostile markup: each nested scope/prop costs a
    // sliceElement scan and the own-prop filter below is props × scopes, so
    // a page stuffed with thousands of them would otherwise be quadratic.
    // A real recipe has a few dozen of each.
    if (nestedRanges.length >= MICRODATA_MAX_TAGS || props.length >= MICRODATA_MAX_TAGS) break;
    const attrs = match[2];
    if (hasBooleanAttr(attrs, "itemscope")) {
      const nested = sliceElement(scope, match.index, MICRODATA_ELEMENT_SCAN_LIMIT);
      if (nested) nestedRanges.push([nested.start, nested.end]);
    }
    const itemprop = getAttr(attrs, "itemprop");
    if (itemprop) props.push({ names: itemprop.split(/\s+/), index: match.index, attrs });
  }

  const ownProps = props.filter(
    (prop) => !nestedRanges.some(([start, end]) => prop.index > start && prop.index < end),
  );
  // `content` is the Microdata value for <meta>, and plenty of templates put
  // it on visible elements too (`<span itemprop="name" content="…">`) as an
  // override for display text — honor it wherever it appears.
  const propValues = (name: string, lines: boolean): string[] =>
    ownProps
      .filter((prop) => prop.names.includes(name))
      .flatMap((prop) => {
        const content = getAttr(prop.attrs, "content");
        if (content !== null) return [htmlToText(content)];
        const element = sliceElement(scope, prop.index, MICRODATA_ELEMENT_SCAN_LIMIT);
        if (!element) return [];
        return lines ? htmlToLines(element.inner) : [htmlToText(element.inner)];
      })
      .filter(Boolean);

  const name = propValues("name", false)[0] ?? pageTitle(html);
  const rawIngredients = propValues("recipeIngredient", false);
  const ingredients = (rawIngredients.length > 0 ? rawIngredients : propValues("ingredients", false)).flatMap(
    parseIngredientLine,
  );
  const instructions = propValues("recipeInstructions", true).join("\n");

  const recipe = { name, instructions, ingredients };
  return hasAnyContent(recipe) ? recipe : null;
}

// ---------------------------------------------------------------------------
// Tier 3: heading heuristic
// ---------------------------------------------------------------------------

// Heading text (after trimming a trailing colon) that introduces the
// ingredient list / the method. English + Swedish (the app's two locales)
// plus the handful of other languages Squirrel users are likeliest to paste
// links in. Anchored so "Ingredients" / "Ingredienser till 4 portioner"
// match but a blog paragraph heading like "Why these ingredients matter"
// doesn't.
