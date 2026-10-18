// GAP-42 — pure helpers for the recipe "Cook" view
// (src/components/meal-planning/cook-mode-dialog.tsx).

// A recipe's instructions are plain text, one step per line (see "Recipe
// import from URL" in REQUIREMENTS.md). Blank lines are separators, not steps.
export function splitSteps(instructions: string | null | undefined): string[] {
  if (!instructions) return [];
  return instructions
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// The factor that turns the recipe's own amounts (which make `servings`
// portions) into amounts for `portions`. Opened from the recipe list there is
// no meal entry, so `portions` is null and amounts stay as written. Guards a
// zero/invalid servings value so the view never shows NaN or Infinity.
export function cookScale(servings: number, portions: number | null): number {
  if (portions == null || !(servings > 0) || !(portions > 0)) return 1;
  return portions / servings;
}

// Scaled amounts are for reading in a kitchen, so two decimals at most and no
// trailing zeros ("0.5", not "0.50"). Intl handles the locale's decimal mark.
export function formatCookQuantity(quantity: number, scale: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(quantity * scale);
}

// GAP-50 — step timers. A step's text is free prose in the cook's own
// language, so the parser is deliberately small: it reads the duration
// phrases cooks actually write in English and Swedish and returns nothing
// for anything it isn't sure of (no button beats a wrong timer).

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
// "15", "1,5" / "1.5", "½", "1½". A Swedish decimal comma is a number
// ("1,5 timmar"), never a list separator.
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?[½¼¾]?|[½¼¾])`;
const UNIT_SECONDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(?:hours?|hrs?|h|timmar|timme|tim)$/i, 3600],
  [/^(?:minutes?|mins?|minuter|minut)$/i, 60],
  [/^(?:seconds?|secs?|sekunder|sekund|sek)$/i, 1],
];
const UNIT = "hours?|hrs?|h|timmar|timme|tim|minutes?|mins?|minuter|minut|seconds?|secs?|sekunder|sekund|sek";
// "10-12 min", "10–12 min", "10 to 12 min", "10 till 12 min", "10 or 12 min".
// The first number's own unit may be left off, so the unit follows the last.
const DURATION = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,])(${NUMBER})(?:\s*(?:-|–|—|to|till|or|eller)\s*(${NUMBER}))?\s*(${UNIT})(?![\p{L}\p{N}])`,
  "giu",
);
// Two phrases in a row are one duration ("1 hour 30 minutes", "1 h och 30 min").
const JOINER = /^\s*(?:,|and|och)?\s*$/i;
const MAX_TIMER_SECONDS = 24 * 3600;

function toNumber(raw: string): number {
  const last = raw.slice(-1);
  if (last in FRACTIONS) {
    const whole = raw.length > 1 ? Number(raw.slice(0, -1).replace(",", ".")) : 0;
    return whole + FRACTIONS[last];
  }
  return Number(raw.replace(",", "."));
}

// Seconds for the duration written in a step, or null when there is none.
// A range ("10-12 min") uses its upper bound, so the timer never rings before
// the food is done. When a step names several separate durations ("sear 2 min
// a side, then bake 20 min") the first wins: it is the one the cook is about
// to do, and the next step's timer starts after it.
export function parseStepDuration(step: string): number | null {
  const pattern = new RegExp(DURATION);
  let total = 0;
  let matched = false;
  let end = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(step))) {
    if (matched && !JOINER.test(step.slice(end, match.index))) break;
    const unitText = match[3];
    const unit = UNIT_SECONDS.find(([unitPattern]) => unitPattern.test(unitText));
    if (!unit) break;
    const amount = Math.max(toNumber(match[1]), match[2] ? toNumber(match[2]) : 0);
    total += amount * unit[1];
    matched = true;
    end = match.index + match[0].length;
  }
  const seconds = Math.round(total);
  return matched && seconds > 0 && seconds <= MAX_TIMER_SECONDS ? seconds : null;
}

// "15 min", "1 h 30 min", "45 s". Unit abbreviations are the same in
// English and Swedish, so no dictionary entry is needed.
export function formatTimerLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean);
  return parts.join(" ") || "0 s";
}

// The countdown chip: "14:32", or "1:05:00" past an hour.
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// UX-94 — the step the cook is on: the first one not yet ticked off, or null
// once every step is done (or there are none). "Next step" ticks this one and
// the view then moves on to the one this returns next.
export function currentStepIndex(total: number, done: ReadonlySet<number>): number | null {
  for (let index = 0; index < total; index++) {
    if (!done.has(index)) return index;
  }
  return null;
}

// UX-94 — whether closing the view would throw something away worth a
// confirmation: a running timer or a step already ticked off. Ticked
// ingredients are prep a cook redoes in seconds, so they don't count.
export function hasCookProgress(doneSteps: number, runningTimers: number): boolean {
  return doneSteps > 0 || runningTimers > 0;
}
