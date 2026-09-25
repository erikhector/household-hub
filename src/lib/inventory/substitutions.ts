// GAP-25 — a small, static "no X? try Y" table for the meal planner's
// missing-ingredients dialog (src/components/meal-planning/
// missing-ingredients-dialog.tsx), so a shortfall comes with a next step
// other than "go buy it" — the swap hint Paprika and Plan to Eat show.
//
// Deliberately the same shape as AUTO-2's category dictionary
// (./auto-category.ts): bilingual ingredient names, stored already
// normalized, mapped to a stable key; the text the user actually reads lives
// in the dictionaries (`mealPlanning.substitutions.<key>` in en.ts/sv.ts), so
// a Swedish household sees "filmjölk" and "msk" rather than an English
// recipe-blog tip, and the table here stays plain data. No AI call and no
// schema change — the table is the whole feature, and it's small enough to
// review by eye.
//
// Matching is intentionally much stricter than auto-category's: the *whole*
// ingredient name has to be a listed name (modulo case/punctuation and a
// plural ending), not just contain one. A category guess that's off by a
// little is harmless, but "chocolate milk → try oat milk" or "egg noodles →
// try flaxseed" would be a wrong cooking instruction. Missing a hint for an
// unusual phrasing ("fresh buttermilk") just means no hint, which is what
// every ingredient got before this existed.
//
// Dependency-free apart from the shared name normalizer, so it runs directly
// in the client dialog without a server round trip.

import { normalizeItemName } from "@/lib/item-matching";

export const SUBSTITUTION_KEYS = [
  "buttermilk",
  "sourCream",
  "cremeFraiche",
  "heavyCream",
  "greekYogurt",
  "milk",
  "butter",
  "egg",
  "mascarpone",
  "ricotta",
  "parmesan",
  "bakingPowder",
  "selfRaisingFlour",
  "cornstarch",
  "potatoStarch",
  "brownSugar",
  "honey",
  "breadcrumbs",
  "lemonJuice",
  "whiteWineVinegar",
  "whiteWine",
  "redWine",
  "shallot",
  "garlic",
] as const;

export type SubstitutionKey = (typeof SUBSTITUTION_KEYS)[number];

// Every name a recipe is likely to use for the ingredient, English then
// Swedish, stored normalized (lowercase, no punctuation — see
// normalizeItemName). Only list names the hint is actually correct for:
// "cream" alone is left out of heavyCream because it's just as often
// cooking cream or sour cream, and a thickening hint for "flour" would be
// meaningless.
const NAMES: Record<SubstitutionKey, string[]> = {
  buttermilk: ["buttermilk", "kärnmjölk"],
  sourCream: ["sour cream", "gräddfil"],
  cremeFraiche: ["crème fraîche", "creme fraiche", "crème fraiche", "creme fraîche"],
  heavyCream: ["heavy cream", "double cream", "whipping cream", "heavy whipping cream", "vispgrädde"],
  greekYogurt: [
    "greek yogurt", "greek yoghurt", "turkisk yoghurt", "grekisk yoghurt", "turkisk yogurt",
    "grekisk yogurt",
  ],
  milk: ["milk", "whole milk", "mjölk", "standardmjölk", "mellanmjölk"],
  butter: ["butter", "unsalted butter", "salted butter", "smör", "osaltat smör", "normalsaltat smör"],
  egg: ["egg", "large egg", "ägg"],
  mascarpone: ["mascarpone"],
  ricotta: ["ricotta"],
  parmesan: ["parmesan", "parmesan cheese", "parmigiano reggiano", "parmesanost"],
  bakingPowder: ["baking powder", "bakpulver"],
  selfRaisingFlour: ["self raising flour", "selfraising flour", "self rising flour", "selfrising flour", "självjäsande mjöl"],
  cornstarch: ["cornstarch", "corn starch", "cornflour", "maizena", "majsena", "majsstärkelse"],
  potatoStarch: ["potato starch", "potato flour", "potatismjöl"],
  brownSugar: ["brown sugar", "light brown sugar", "dark brown sugar", "farinsocker", "brunt farinsocker"],
  honey: ["honey", "honung", "flytande honung"],
  breadcrumbs: ["breadcrumbs", "bread crumbs", "panko", "ströbröd"],
  lemonJuice: ["lemon juice", "citronsaft", "citronjuice", "pressad citron"],
  whiteWineVinegar: ["white wine vinegar", "vitvinsvinäger"],
  whiteWine: ["white wine", "dry white wine", "vitt vin", "torrt vitt vin"],
  redWine: ["red wine", "dry red wine", "rött vin", "rödvin"],
  shallot: ["shallot", "schalottenlök", "schalottenlökar"],
  garlic: ["garlic", "garlic clove", "clove garlic", "vitlök", "vitlöksklyfta", "vitlöksklyftor"],
};

/** Exported for the duplicate-name guard in the test file only. */
export const SUBSTITUTION_NAMES: Readonly<Record<SubstitutionKey, readonly string[]>> = NAMES;

const index = new Map<string, SubstitutionKey>();
for (const key of SUBSTITUTION_KEYS) {
  for (const name of NAMES[key]) index.set(normalizeItemName(name), key);
}

/**
 * The name with its likely singular forms of the last word — "eggs" → "egg",
 * "shallots" → "shallot", "cloves garlic" stays as is. Only the head noun
 * (the last word, in both languages) is de-pluralized, and only English -s;
 * the handful of Swedish plurals that matter are listed as names above,
 * because Swedish plural endings (-or/-ar/-er) would over-generate onto
 * words like "smör".
 */
function candidates(normalized: string): string[] {
  const out = [normalized];
  const lastSpace = normalized.lastIndexOf(" ");
  const head = normalized.slice(0, lastSpace + 1);
  const last = normalized.slice(lastSpace + 1);
  if (last.length > 3 && last.endsWith("s")) out.push(head + last.slice(0, -1));
  return out;
}

/**
 * The substitution key for an ingredient name, or null when the table has
 * no confident swap for it. The caller maps the key to the locale's hint
 * text (`dict.substitutions[key]`).
 */
export function findSubstitutionKey(name: string): SubstitutionKey | null {
  const normalized = normalizeItemName(name);
  if (!normalized) return null;
  for (const candidate of candidates(normalized)) {
    const key = index.get(candidate);
    if (key) return key;
  }
  return null;
}
