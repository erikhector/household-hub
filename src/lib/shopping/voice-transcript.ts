import { isUnitWord } from "@/lib/inventory/parse-pasted-list";
import type { Locale } from "@/lib/i18n/locales";

// Voice add (AUTO-12): the smart add line's mic button hands the browser's
// speech-recognition transcript to normalizeVoiceTranscript, and the result
// goes through parseSmartAddInput exactly like typed text. Everything that
// makes speech different from typing lives here, so the parser itself stays
// the one shared, typed-text path:
//
//   - people *say* numbers ("two", "två") where they'd type digits, and
//     parsePastedList only understands digits;
//   - they say "liters"/"kilo" where they'd type "l"/"kg", and "of"
//     ("two liters of milk") where they'd type nothing;
//   - they separate items with "and"/"och" rather than commas.
//
// Deliberately small, like parsePastedList: it only needs to get the common
// shopping phrasings right. Most recognizers already emit digits for
// anything past a handful, so the number words only go up to 99.

/** BCP 47 tag for the recognizer, from the app's locale cookie. */
export function speechRecognitionLang(locale: Locale): string {
  return locale === "sv" ? "sv-SE" : "en-US";
}

/** The failure buckets the smart add line toasts on (use-speech-recognition). */
export type SpeechRecognitionFailure = "denied" | "no-speech" | "failed";

/**
 * Maps a Web Speech API error to the toast bucket. UX-29: `service-not-allowed`
 * is what Chrome reports when the recognition *service* is unreachable (no
 * network for the server-side recognizer, or the device offers none) — there
 * is nothing the user could allow in site settings, so it reads as
 * "unavailable here" (`failed`) rather than "blocked" (`denied`).
 */
export function mapSpeechRecognitionError(error: string): SpeechRecognitionFailure {
  if (error === "not-allowed") return "denied";
  if (error === "no-speech") return "no-speech";
  return "failed";
}

type NumberWords = {
  ones: Record<string, number>;
  tens: Record<string, number>;
  /** "a"/"an", "en"/"ett" — a count only when more words follow, so "a
   * bag of rice" is 1 bag but nothing turns a lone article into "1". */
  articles: Set<string>;
  /** "dozen"/"dussin", which also takes an article: "a dozen eggs" = 12. */
  dozen: string;
  /** The filler between a unit and the name: "two liters *of* milk". */
  of: string;
  and: string;
};

const EN: NumberWords = {
  ones: {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  },
  tens: { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
  articles: new Set(["a", "an"]),
  dozen: "dozen",
  of: "of",
  and: "and",
};

const SV: NumberWords = {
  ones: {
    en: 1,
    ett: 1,
    två: 2,
    tre: 3,
    fyra: 4,
    fem: 5,
    sex: 6,
    sju: 7,
    åtta: 8,
    nio: 9,
    tio: 10,
    elva: 11,
    tolv: 12,
    tretton: 13,
    fjorton: 14,
    femton: 15,
    sexton: 16,
    sjutton: 17,
    arton: 18,
    nitton: 19,
  },
  tens: { tjugo: 20, trettio: 30, fyrtio: 40, femtio: 50, sextio: 60, sjuttio: 70, åttio: 80, nittio: 90 },
  // "en"/"ett" are both the article and the number one in Swedish, and
  // already sit in `ones` — so "en gurka" is 1 gurka either way.
  articles: new Set(),
  dozen: "dussin",
  of: "av",
  and: "och",
};

const WORDS: Record<Locale, NumberWords> = { en: EN, sv: SV };

// Spoken unit names → the abbreviation parsePastedList's UNIT_WORDS knows.
// One map for both languages: the metric words are shared, and a Swedish
// recognizer happily returns "kilogram" or "liter" either way.
const SPOKEN_UNITS: Record<string, string> = {
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  deciliter: "dl",
  deciliters: "dl",
  decilitre: "dl",
  decilitres: "dl",
  centiliter: "cl",
  centiliters: "cl",
  centilitre: "cl",
  centilitres: "cl",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  hekto: "hg",
  hekton: "hg",
  stycken: "st",
};

const DIGITS = /^\d+(?:[.,]\d+)?$/;

const isSpokenUnit = (token: string) =>
  Object.hasOwn(SPOKEN_UNITS, token.toLowerCase()) || isUnitWord(token);

/**
 * A spoken number at `tokens[i]`, and how many tokens it used: "twenty
 * four", "twenty-four", Swedish's written-together "tjugofyra", a plain
 * word, or "a dozen"/"ett dussin". Null when it isn't a number word.
 */
function readNumber(tokens: string[], i: number, words: NumberWords): { value: number; length: number } | null {
  const token = tokens[i].toLowerCase();
  const next = tokens[i + 1]?.toLowerCase();

  if (token === words.dozen) return { value: 12, length: 1 };
  if (next === words.dozen && (words.articles.has(token) || words.ones[token] === 1)) {
    return { value: 12, length: 2 };
  }

  if (Object.hasOwn(words.ones, token)) return { value: words.ones[token], length: 1 };

  for (const [tensWord, tens] of Object.entries(words.tens)) {
    if (token === tensWord) {
      // "twenty four" as two tokens.
      if (next && Object.hasOwn(words.ones, next) && words.ones[next] < 10) {
        return { value: tens + words.ones[next], length: 2 };
      }
      return { value: tens, length: 1 };
    }
    // "twenty-four" / "tjugofyra" / "tjugoett".
    if (token.startsWith(tensWord)) {
      const rest = token.slice(tensWord.length).replace(/^-/, "");
      if (Object.hasOwn(words.ones, rest) && words.ones[rest] < 10) {
        return { value: tens + words.ones[rest], length: 1 };
      }
    }
  }

  if (words.articles.has(token) && tokens.length > i + 1) return { value: 1, length: 1 };
  return null;
}

/** One item's worth of transcript: numbers to digits, unit words to units. */
function normalizeSegment(segment: string, words: NumberWords): string {
  const tokens = segment.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    // A number word only counts at the start of the item ("two eggs") or
    // right before a unit ("mjölk två liter"), so a name that happens to
    // contain one ("pasta with ten herbs") is left alone everywhere else.
    const spoken = readNumber(tokens, i, words);
    const isCount =
      spoken && (out.length === 0 || (tokens[i + spoken.length] && isSpokenUnit(tokens[i + spoken.length])));
    let number: string | null = null;
    if (spoken && isCount) {
      number = String(spoken.value);
      i += spoken.length;
    } else if (DIGITS.test(token)) {
      number = token;
      i += 1;
    }

    if (number === null) {
      out.push(token);
      i += 1;
      continue;
    }

    out.push(number);
    const unit = tokens[i];
    if (unit && isSpokenUnit(unit)) {
      out.push(SPOKEN_UNITS[unit.toLowerCase()] ?? unit);
      i += 1;
      // "two liters of milk" → "2 l milk": the parser would otherwise keep
      // "of" as the first word of the name. Only when a name follows.
      if (tokens[i]?.toLowerCase() === words.of && tokens.length > i + 1) i += 1;
    }
  }
  return out.join(" ");
}

/**
 * Turns a speech transcript into the text the smart add line parses:
 * "two liters of milk and eggs" → "2 l milk, eggs", "tre burkar krossade
 * tomater och ett dussin ägg" → "3 burkar krossade tomater, 12 ägg".
 * Items are split on commas and on the locale's "and" — which does split a
 * name like "salt och peppar" in two, but that's an easy fix in the list
 * and far rarer than "milk and eggs".
 */
export function normalizeVoiceTranscript(transcript: string, locale: Locale): string {
  const words = WORDS[locale];
  const andPattern = new RegExp(`\\s+${words.and}\\s+`, "i");
  return transcript
    .split(/[,;\n]+/)
    .flatMap((part) => part.split(andPattern))
    .map((segment) => segment.trim().replace(/[.!?]+$/, "").trim())
    .filter(Boolean)
    .map((segment) => normalizeSegment(segment, words))
    .filter(Boolean)
    .join(", ");
}
