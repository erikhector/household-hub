// GAP-70 — the page a recipe came from, and the household's own notes on it.
// One place decides what counts as a usable source link so the form action,
// the URL import and the file import can't drift apart.

const RECIPE_SOURCE_URL_MAX = 2048;
export const RECIPE_NOTES_MAX = 2000;

/**
 * The address as the URL parser normalises it when it is an http or https
 * link within the length limit, otherwise null. Only the scheme is checked:
 * the link is shown as a plain external link and is never fetched by the
 * server, so the SSRF host rules of the URL import don't apply here. A
 * `javascript:` or `data:` address must never reach an `href`, which is why
 * this is checked on the way in (every write) and again on the way out
 * (`normalizeSourceUrl` in the sheet) for rows saved before a rule changed.
 */
export function normalizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > RECIPE_SOURCE_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const href = url.toString();
  return href.length > RECIPE_SOURCE_URL_MAX ? null : href;
}

/** "bbc.co.uk" for "https://www.bbc.co.uk/food/x": the host without a leading www. */
export function sourceHost(url: string): string | null {
  const safe = normalizeSourceUrl(url);
  if (!safe) return null;
  return new URL(safe).hostname.replace(/^www\./i, "");
}
