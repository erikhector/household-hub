// AUTO-2 — pure category guessing for items that arrive without one (a
// shopping-list add, a receipt line, a paste, a quick-add, a barcode scan),
// so they stop piling up under "Uncategorized" and turning
// ResolveMappingsDialog into a manual sorting job. Dependency-free apart from
// the shared name normalizer so it's unit-testable without mocks; the
// server-side wiring (loading the household's items and the locale's labels)
// lives in src/lib/inventory/category-resolver.ts.
//
// Resolution is cheapest-first and fully deterministic — no AI key needed:
//   1. Household memory: an existing item with the same (or confidently
//      similar) name reuses that item's category. This is also how a user's
//      correction sticks — once they've moved "Havregryn" to "Frukost", every
//      later "havregryn" follows it and the dictionary is never consulted.
//   2. A built-in bilingual keyword dictionary → one of a handful of
//      canonical category keys, which the caller maps to the locale's label
//      (`inventory.autoCategories` in en.ts/sv.ts).
// Nothing here ever overrides a category the user typed; callers only use it
// to fill in a blank.

import { findInventoryMatches, normalizeItemName } from "@/lib/item-matching";

// Order doubles as a sensible walk through a store (produce first, non-food
// last) — the fixed default AUTO-3's category grouping can lean on.
export const AUTO_CATEGORY_KEYS = [
  "produce",
  "bakery",
  "dairy",
  "meat",
  "pantry",
  "frozen",
  "drinks",
  "cleaning",
  "bathroom",
] as const;

export type AutoCategoryKey = (typeof AUTO_CATEGORY_KEYS)[number];

// Keywords are stored already normalized (lowercase, no punctuation). Single
// words match a name token exactly, or — for Swedish compounds, which put the
// head noun last ("kycklingfilé", "vispgrädde", "apelsinjuice") — as the
// token's suffix. Multi-word entries are phrases and win over single words,
// which is how "peanut butter" avoids landing in dairy and "dish soap" in the
// bathroom. Where a suffix match would guess wrong ("jordnötssmör" ends in
// "smör", "disksvamp" in "svamp", "foil" in "oil"), the longer word is listed
// explicitly so its exact match wins first.
const KEYWORDS: Record<AutoCategoryKey, string[]> = {
  produce: [
    // en
    "apple", "banana", "orange", "lemon", "lime", "pear", "grape", "strawberry", "blueberry",
    "raspberry", "berry", "melon", "watermelon", "pineapple", "mango", "kiwi", "avocado", "peach",
    "plum", "cherry", "tomato", "cucumber", "lettuce", "salad", "spinach", "kale", "cabbage",
    "broccoli", "cauliflower", "carrot", "potato", "onion", "garlic", "ginger", "zucchini",
    "courgette", "eggplant", "aubergine", "mushroom", "celery", "leek", "corn", "asparagus",
    "radish", "beetroot", "squash", "pumpkin", "fruit", "vegetable", "veggies", "greens",
    "arugula", "rocket", "clementine", "mandarin", "grapefruit", "nectarine", "apricot", "fig",
    "pomegranate", "rhubarb", "shallot", "chili", "chilli", "basil", "parsley", "dill",
    "coriander", "cilantro", "herbs", "bell pepper", "sweet potato", "spring onion",
    // sv
    "äpple", "äpplen", "banan", "apelsin", "citron", "päron", "druva", "vindruva", "jordgubbe",
    "blåbär", "hallon", "bär", "vattenmelon", "ananas", "avokado", "persika", "plommon",
    "körsbär", "tomat", "gurka", "sallad", "spenat", "grönkål", "kål", "blomkål", "morot",
    "morötter", "potatis", "lök", "vitlök", "ingefära", "svamp", "champinjon", "kantarell",
    "selleri", "majs", "sparris", "rädisa", "rödbeta", "sötpotatis", "pumpa", "frukt",
    "grönsak", "ruccola", "clementin", "grapefrukt", "nektarin", "aprikos", "fikon",
    "granatäpple", "rabarber", "basilika", "persilja", "koriander", "örter", "paprika", "lingon",
  ],
  bakery: [
    // en
    "bread", "bagel", "bun", "baguette", "croissant", "muffin", "cake", "pita", "crispbread",
    "sourdough", "pastry", "doughnut", "donut", "pie", "brioche", "ciabatta", "focaccia",
    "toast", "breads", "rolls", "bread rolls",
    // sv
    "bröd", "limpa", "bulle", "kanelbulle", "fralla", "baguett", "knäckebröd", "tunnbröd",
    "surdeg", "bakelse", "wienerbröd", "tårta", "kaka",
  ],
  dairy: [
    // en
    "milk", "cheese", "butter", "yogurt", "yoghurt", "cream", "egg", "kefir", "quark",
    "margarine", "feta", "mozzarella", "parmesan", "cheddar", "brie", "halloumi", "ricotta",
    "mascarpone", "custard", "dairies", "sour cream", "cream cheese", "cottage cheese",
    "creme fraiche", "crème fraîche",
    // sv
    "mjölk", "ost", "smör", "grädde", "ägg", "keso", "gräddfil", "fil", "filmjölk", "kvarg",
    "margarin", "bregott", "kesella", "crème fraiche", "vaniljkräm",
  ],
  meat: [
    // en
    "chicken", "beef", "pork", "lamb", "ham", "bacon", "sausage", "mince", "steak", "turkey",
    "salami", "meatball", "fish", "salmon", "tuna", "cod", "shrimp", "prawn", "mussel", "crab",
    "chorizo", "prosciutto", "fillet", "meat", "meats", "fishes", "seafood", "minced meat",
    "ground beef", "hot dog",
    // sv
    "kyckling", "nötkött", "fläsk", "lamm", "skinka", "korv", "färs", "biff", "kalkon",
    "köttbulle", "fisk", "lax", "torsk", "räka", "mussla", "krabba", "kött", "kotlett",
    "entrecote", "filé", "sill", "strömming", "kassler", "leverpastej", "pålägg",
  ],
  pantry: [
    // en
    "rice", "pasta", "spaghetti", "macaroni", "noodle", "flour", "sugar", "salt", "oil",
    "vinegar", "coffee", "tea", "cereal", "oats", "oatmeal", "muesli", "granola", "cornflakes",
    "bean", "lentil", "chickpea", "ketchup", "mustard", "mayonnaise", "mayo", "sauce", "spice",
    "honey", "jam", "nutella", "chocolate", "candy", "chips", "crisps", "nut", "popcorn",
    "cracker", "cookie", "biscuit", "soup", "stock", "broth", "bouillon", "yeast", "vanilla",
    "cocoa", "cinnamon", "tortilla", "taco", "salsa", "pesto", "olive", "raisin", "licorice",
    "snacks", "sweets", "condiments", "spreads", "cereals", "sauces", "canned", "olive oil",
    "peanut butter", "soy sauce", "baking powder", "baking soda", "baking paper",
    "tomato paste", "black pepper", "canned tomatoes", "crushed tomatoes",
    // sv
    "ris", "spagetti", "makaroner", "nudlar", "mjöl", "socker", "olja", "vinäger", "ättika",
    "kaffe", "te", "flingor", "havregryn", "müsli", "böna", "lins", "kikärta", "tomatpuré",
    "senap", "majonnäs", "sås", "buljong", "jäst", "bakpulver", "kakao", "kanel", "krydda",
    "honung", "sylt", "marmelad", "choklad", "godis", "nötter", "kex", "soppa", "tacos", "oliv",
    "russin", "lakrits", "jordnötssmör", "peppar", "bakplåtspapper", "konserv",
    "krossade tomater",
  ],
  frozen: [
    // en
    "frozen", "pizza", "fries", "popsicle", "ice cream", "fish sticks", "fish fingers",
    "french fries", "frozen foods",
    // sv
    "glass", "fryst", "frysta", "djupfryst", "djupfrysta", "fiskpinne", "pommes",
    "pommes frites",
  ],
  drinks: [
    // en
    "juice", "soda", "water", "beer", "wine", "cider", "lemonade", "cola", "coke", "smoothie",
    "drink", "beverages", "drinks", "waters", "sparkling water",
    // sv
    "läsk", "vatten", "mineralvatten", "öl", "vin", "saft", "dryck", "festis", "must",
  ],
  cleaning: [
    // en
    "detergent", "sponge", "bleach", "cleaner", "softener", "foil", "dishwasher", "cleaning",
    "dish soap", "paper towel", "paper towels", "trash bags", "garbage bags", "bin bags",
    "cling film", "plastic wrap", "rinse aid", "dishwasher tablets", "kitchen roll",
    // sv
    "diskmedel", "tvättmedel", "hushållspapper", "soppåse", "sopsäck", "disksvamp", "klorin",
    "rengöring", "rengöringsmedel", "sköljmedel", "folie", "diskborste", "disktablett",
    "diskmaskinstablett", "wettex", "trasa",
  ],
  bathroom: [
    // en
    "shampoo", "conditioner", "toothpaste", "toothbrush", "soap", "deodorant", "razor",
    "lotion", "sunscreen", "tampon", "floss", "mouthwash", "sanitizer", "tissues", "diaper",
    "wipes", "toilet paper", "toilet roll", "hand soap", "body wash", "shower gel",
    "hand sanitizer", "cotton pads",
    // sv
    "toalettpapper", "toapapper", "schampo", "balsam", "tandkräm", "tandborste", "tvål",
    "deo", "rakhyvel", "rakblad", "solkräm", "tampong", "binda", "bomull", "tandtråd",
    "munskölj", "handsprit", "duschgel", "näsduk", "blöja", "våtservett", "kräm",
  ],
};

// A leading "frozen"/"fryst" puts the item in the freezer aisle whatever the
// noun is ("frozen peas", "frysta hallon") — checked before the head-noun
// lookup below, which would otherwise file those under produce.
const FROZEN_MODIFIERS = new Set(["frozen", "fryst", "frysta", "djupfryst", "djupfrysta"]);

// Suffix matching is limited to keywords at least this long — "te" (tea) or
// "öl" (beer) as a suffix would match half the language.
const MIN_SUFFIX_KEYWORD_LENGTH = 3;

const wordIndex = new Map<string, AutoCategoryKey>();
const phrases: { tokens: string[]; key: AutoCategoryKey }[] = [];
for (const key of AUTO_CATEGORY_KEYS) {
  for (const keyword of KEYWORDS[key]) {
    const normalized = normalizeItemName(keyword);
    if (normalized.includes(" ")) phrases.push({ tokens: normalized.split(" "), key });
    else if (!wordIndex.has(normalized)) wordIndex.set(normalized, key);
  }
}
// Longest phrase first, so "fish sticks" (frozen) outranks "fish" (meat) and
// "cream cheese" (dairy) is matched as a whole rather than as "cheese".
phrases.sort((a, b) => b.tokens.length - a.tokens.length);
const suffixWords = [...wordIndex.keys()]
  .filter((word) => word.length >= MIN_SUFFIX_KEYWORD_LENGTH)
  .sort((a, b) => b.length - a.length);

/** Exported for the duplicate-keyword guard in the test file only. */
export const AUTO_CATEGORY_KEYWORDS: Readonly<Record<AutoCategoryKey, readonly string[]>> = KEYWORDS;

/**
 * The token plus its likely singular forms: English -s/-es/-ies and Swedish
 * -er/-ar/-or plurals ("tomatoes" → "tomato", "bananer" → "banan", "gurkor" →
 * "gurka", "bullar" → "bulle"). Over-generating is harmless — a stem only
 * matters if it happens to be a keyword.
 */
function stems(token: string): string[] {
  const out = [token];
  if (token.length <= 3) return out;
  if (token.endsWith("ies")) out.push(`${token.slice(0, -3)}y`);
  if (token.endsWith("es")) out.push(token.slice(0, -2));
  if (token.endsWith("s")) out.push(token.slice(0, -1));
  if (token.endsWith("er")) out.push(token.slice(0, -2));
  if (token.endsWith("ar")) out.push(token.slice(0, -2), `${token.slice(0, -2)}e`);
  if (token.endsWith("or")) out.push(`${token.slice(0, -2)}a`);
  return out;
}

function matchPhrase(tokenStems: string[][]): AutoCategoryKey | null {
  for (const phrase of phrases) {
    for (let start = 0; start + phrase.tokens.length <= tokenStems.length; start++) {
      if (phrase.tokens.every((word, i) => tokenStems[start + i].includes(word))) return phrase.key;
    }
  }
  return null;
}

function matchToken(forms: string[]): AutoCategoryKey | null {
  for (const form of forms) {
    const exact = wordIndex.get(form);
    if (exact) return exact;
  }
  for (const form of forms) {
    const suffix = suffixWords.find((word) => form.length > word.length && form.endsWith(word));
    if (suffix) return wordIndex.get(suffix) ?? null;
  }
  return null;
}

/**
 * Dictionary-only guess of a canonical category for an item name, or null
 * when nothing matches (the caller then leaves the item uncategorized).
 * Tokens are tried last-to-first, because both English and Swedish put the
 * head noun last: "chocolate milk" is milk, "tomato soup" is soup.
 */
export function guessCategoryKey(name: string): AutoCategoryKey | null {
  const normalized = normalizeItemName(name);
  if (!normalized) return null;
  const tokenStems = normalized.split(" ").map(stems);

  const phrase = matchPhrase(tokenStems);
  if (phrase) return phrase;
  if (tokenStems.some((forms) => FROZEN_MODIFIERS.has(forms[0]))) return "frozen";

  for (let i = tokenStems.length - 1; i >= 0; i--) {
    const key = matchToken(tokenStems[i]);
    if (key) return key;
  }
  return null;
}

/**
 * Maps Open Food Facts' `categories_tags` (e.g. `["en:dairies", "en:milks"]`,
 * listed general → specific) to a canonical key by running each tag through
 * the same dictionary, most specific first. The catch-all
 * "plant-based-foods-and-beverages" family is skipped: it tags coffee and
 * carrots alike, and its trailing "beverages" would file everything as a
 * drink.
 */
export function categoryKeyFromOpenFoodFactsTags(tags: readonly string[]): AutoCategoryKey | null {
  for (let i = tags.length - 1; i >= 0; i--) {
    const tag = tags[i];
    if (typeof tag !== "string" || tag.includes("plant-based")) continue;
    const words = tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ");
    const key = guessCategoryKey(words);
    if (key) return key;
  }
  return null;
}

// Fuzzy household-memory matches must be at least this close — "mjölk 3%"
// still converges on the household's "Mjölk", but a merely similar-looking
// name doesn't borrow an unrelated item's category.
const MEMORY_MIN_SCORE = 0.8;

export type KnownItem = { name: string; category: string };

/**
 * Full resolution for a new item's blank category: household memory first,
 * then the dictionary. Returns the label to store, or null when neither step
 * knows (the caller falls back to its "Uncategorized" label).
 *
 * `placeholderCategories` are the "Uncategorized" labels (every locale's) —
 * an existing item still sitting there has no real category to lend.
 */
export function resolveAutoCategory(
  name: string,
  {
    knownItems,
    labels,
    placeholderCategories,
  }: {
    knownItems: readonly KnownItem[];
    labels: Record<AutoCategoryKey, string>;
    placeholderCategories: readonly string[];
  },
): string | null {
  const placeholders = new Set(placeholderCategories.map((c) => c.trim().toLowerCase()));
  const candidates = knownItems
    .filter((item) => item.category.trim() && !placeholders.has(item.category.trim().toLowerCase()))
    .map((item, i) => ({ id: String(i), name: item.name, category: item.category }));

  const [best] = findInventoryMatches(name, candidates, { limit: 1, minScore: MEMORY_MIN_SCORE });
  if (best) return best.category;

  const key = guessCategoryKey(name);
  return key ? labels[key] : null;
}
