import { Client } from "pg";
import { E2E_WORKER } from "./seed-data";

// MAINT-108: the one way a spec reaches Postgres and names what it inserts.
// These used to be copied into every spec (connect/try/finally wrappers
// under two names, eight variants of the name suffix), so a fix to the
// pattern had to be made forty times and the weaker variants kept
// spreading. A spec file must not open its own `new Client(`: the ESLint
// rule in eslint.config.mjs fails it.

/** Runs `run` on a fresh connection to the e2e database and always closes
 * it, whether `run` resolves or throws. */
export async function withDb<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// A visible name's tag is letters only. Names go through parsers that read
// digits: the smart add line takes a trailing "x29" as a quantity ("Oat
// drink mves4x29" became "Oat drink mves4" × 29) and "2 kg" as an amount,
// so a tag with a digit in it can lose part of itself.
//
// And it's random rather than time-based. Smart add and the inventory's
// duplicate check fold a name into one that shares enough letter pairs
// (src/lib/inventory/duplicates.ts, FUZZY_MIN_SCORE), and every run leaves
// its rows behind: two timestamps a few seconds apart differ only in their
// last letters, so one run's name could be taken for an earlier run's (see
// shopping-added-by.spec.ts and item-catalog.spec.ts). Nine random letters
// (26^9 of them) never repeat in practice and share almost no pairs. The
// worker leads, as a letter (AGENTS.md, "Parallel workers"). uniqueId
// keeps a timestamp, since nothing compares ids.
const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const letters = (n: number) =>
  n.toString(26).replace(/[0-9a-p]/g, (digit) => LETTERS[parseInt(digit, 26)]);

/** One letters-only word no other run, worker or project shares: this
 * worker, then nine random letters. For a test that puts the same tag in
 * several names (and ids) that belong together, then searches for it; a
 * single name is `unique(label)`. */
export function uniqueTag(): string {
  let tag = letters(E2E_WORKER);
  for (let i = 0; i < 9; i++) tag += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return tag;
}

/** A visible name no other run, worker or project shares: `label`, a space,
 * then a `uniqueTag()`. Safe to type into the smart add line and to match
 * by regex. */
export function unique(label: string): string {
  return `${label} ${uniqueTag()}`;
}

/** A primary key no other run, worker or project shares (AGENTS.md,
 * "Parallel workers": every inserted id carries E2E_WORKER). It starts with
 * `${prefix}-w${E2E_WORKER}-`, so a cleanup can match this worker's rows
 * with LIKE. Never shown, so digits are fine. */
export function uniqueId(prefix: string): string {
  return `${prefix}-w${E2E_WORKER}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday of `day`'s week, the same day getWeekStart
 * (src/app/dashboard/meal-planning/date-utils.ts) picks. `day` is a UTC
 * midnight, as a stored date is. */
export function mondayOf(day: Date): Date {
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}
