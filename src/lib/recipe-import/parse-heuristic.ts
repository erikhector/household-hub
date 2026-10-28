import { htmlToLines, htmlToText, pageTitle, sliceElement } from "./html";
import { parseIngredientLine } from "./parse-ingredient";
import type { ParsedRecipe } from "./types";

const INGREDIENTS_HEADING_RE =
  /^(?:the\s+)?(?:ingredients?|ingredienser|zutaten|ingrédients|ingrediënten|ingredienten|ingredientes|ingredienti|ainekset|du behöver|det här behöver du)(?:\s*\(.*\)|\s+(?:for|för|till|für|pour|voor|para|per)\s.*)?$/i;
const INSTRUCTIONS_HEADING_RE =
  /^(?:instructions?|directions?|method|preparation|steps|how to make it|gör så här|så här gör du|så gör du|instruktioner|tillagning|tillvägagångssätt|zubereitung|préparation|bereiding|preparación|preparazione|valmistus)$/i;

const HEADING_OR_LIST_RE = /<(h[1-6]|ul|ol|p)\b[^>]*>/gi;
// Past this many characters after the heading we stop looking — a list that
// far away is almost certainly not the one the heading introduced.
const HEURISTIC_SECTION_LIMIT = 20_000;

type Heading = { level: number; text: string; start: number; end: number };

// A heading's text is short; its close tag is looked for only this far past
// the opening tag. Unbounded (`<h([1-6])>[\s\S]*?<\/h\1>`), a page of
// unclosed `<h2>`s makes every one of them scan to the end of the document —
// quadratic on attacker-controlled input. An unclosed or absurdly long
// heading just isn't treated as one.
const HEADING_SCAN_LIMIT = 2_000;
const HEADING_OPEN_RE = /<h([1-6])\b[^>]*>/gi;

function findHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(HEADING_OPEN_RE)) {
    const contentStart = match.index + match[0].length;
    const window = html.slice(contentStart, contentStart + HEADING_SCAN_LIMIT);
    const close = window.match(new RegExp(`</h${match[1]}\\s*>`, "i"));
    if (!close || close.index === undefined) continue;
    headings.push({
      level: Number(match[1]),
      text: htmlToText(window.slice(0, close.index)).replace(/\s*:$/, ""),
      start: match.index,
      end: contentStart + close.index + close[0].length,
    });
  }
  return headings;
}

/**
 * Lines of the section a heading introduces: the items of every `<ul>`/`<ol>`
 * up to the next heading at the same or a higher level (so a sub-heading
 * like "For the sauce" under "Ingredients" keeps going), or up to the other
 * section's heading. If the section has no list at all, its paragraphs are
 * used instead — some blogs write the method as plain `<p>` steps, or the
 * ingredients as one `<p>` with `<br>`s.
 */
function collectSection(html: string, heading: Heading, stopRe: RegExp): string[] {
  const windowEnd = Math.min(html.length, heading.end + HEURISTIC_SECTION_LIMIT);
  const listLines: string[] = [];
  const paragraphLines: string[] = [];
  const re = new RegExp(HEADING_OR_LIST_RE.source, "gi");
  re.lastIndex = heading.end;
  for (let m = re.exec(html); m && m.index < windowEnd; m = re.exec(html)) {
    const tag = m[1].toLowerCase();
    if (tag === "p") {
      // `</p>` is optional in HTML, so a paragraph ends at its close tag *or*
      // the next block-level element — never let an unclosed `<p>` swallow
      // the heading that should stop this section.
      const contentStart = m.index + m[0].length;
      const rest = html.slice(contentStart, windowEnd);
      const stop = rest.search(/<\/p\s*>|<(?:p|h[1-6]|ul|ol|div)\b/i);
      const inner = stop === -1 ? rest : rest.slice(0, stop);
      paragraphLines.push(...htmlToLines(inner));
      re.lastIndex = contentStart + inner.length;
      continue;
    }
    const element = sliceElement(html, m.index, windowEnd - m.index);
    if (!element) break;
    if (tag.startsWith("h")) {
      const text = htmlToText(element.inner).replace(/\s*:$/, "");
      if (Number(tag[1]) <= heading.level || stopRe.test(text)) break;
      continue;
    }
    // A list: one line per `<li>`, where an item runs to the next `<li` or
    // list close (`</li>` is optional too). A nested sub-list's items come
    // out as their own lines after the parent item's text.
    for (const li of element.inner.matchAll(/<li\b[^>]*>([\s\S]*?)(?=<li\b|<\/[ou]l\s*>|$)/gi)) {
      const text = htmlToText(li[1]);
      if (text) listLines.push(text);
    }
    re.lastIndex = element.end;
  }
  return listLines.length > 0 ? listLines : paragraphLines;
}

/**
 * Last-resort extraction for pages with no structured data: the page title
 * plus whatever follows an "Ingredients" heading (and, if present, a
 * "Method"/"Gör så här" heading). Requires at least one ingredient — a page
 * title alone would "succeed" on every blog post and just pre-fill junk.
 */
export function parseHeuristicRecipe(html: string): ParsedRecipe | null {
  const headings = findHeadings(html);
  const ingredientsHeading = headings.find((h) => INGREDIENTS_HEADING_RE.test(h.text));
  if (!ingredientsHeading) return null;

  const ingredients = collectSection(html, ingredientsHeading, INSTRUCTIONS_HEADING_RE)
    .flatMap(parseIngredientLine)
    .filter((ingredient) => ingredient.name);
  if (ingredients.length === 0) return null;

  const instructionsHeading = headings.find((h) => INSTRUCTIONS_HEADING_RE.test(h.text));
  const instructions = instructionsHeading
    ? collectSection(html, instructionsHeading, INGREDIENTS_HEADING_RE).join("\n")
    : "";

  return { name: pageTitle(html), instructions, ingredients };
}

// ---------------------------------------------------------------------------
// SSRF-guarding URL validation + fetch
// ---------------------------------------------------------------------------
