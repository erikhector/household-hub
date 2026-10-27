// The Transactions tab's search box (GAP-63): "where did that 340 kr go?".
// A pure matcher over rows the page has already loaded, so typing never
// refetches. No "use server", no Prisma: safe in Client Components and
// unit-tested directly. Reading only, so it never touches money maths.

/** Lowercase and strip accents, so "cafe" finds "Café" and "ost" finds
 * "Öst". Both sides of every comparison go through this. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The term as an amount when the whole of it is a number: digits with an
 * optional decimal part, written with a comma or a dot ("340", "340,50",
 * "340.5"). Anything else (a word, "3,4,5", "340 kr") is not an amount. */
function parseAmountTerm(term: string): number | null {
  if (!/^\d+([.,]\d{1,2})?$/.test(term)) return null;
  return Number(term.replace(",", "."));
}

/** What the search and its `?q=` param hold: trimmed, so a stray space
 * is no filter at all. */
export function normalizeSearchTerm(term: string | null | undefined): string {
  return (term ?? "").trim();
}

/**
 * Does a row match what the person typed? A case- and accent-insensitive
 * substring of the description or the category name, or, when the term is a
 * number, the amount equal to it ("340" and "340,50" alike; the amount is
 * compared to the cent, not as text, so "34" does not find 340). An empty
 * term matches everything.
 */
export function transactionMatchesSearch(
  row: { description: string | null; categoryName: string; amount: number },
  term: string,
): boolean {
  const trimmed = normalizeSearchTerm(term);
  if (!trimmed) return true;
  const needle = fold(trimmed);
  if (fold(row.description ?? "").includes(needle)) return true;
  if (fold(row.categoryName).includes(needle)) return true;
  const amount = parseAmountTerm(trimmed);
  return amount !== null && Math.round(row.amount * 100) === Math.round(amount * 100);
}
