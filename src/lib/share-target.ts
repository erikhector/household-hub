// GAP-67: the Web Share Target (manifest.ts `share_target`). Android Chrome
// and Edge list an installed Squirrel in the share sheet and open
// /dashboard/share?title=…&text=…&url=… with whatever the sharing app sent.
// This maps those params to where the shared thing is pre-filled. It only
// ever returns one of two fixed in-app paths with the shared text as an
// encoded query value, never a path built from the input, so a crafted link
// can't make the handler an open redirect.

export const SHARE_PATH = "/dashboard/share";
// Read by the recipe manager and the shopping list, which open their dialog
// with the field filled in and then strip the param.
export const SHARE_URL_PARAM = "importUrl";
export const SHARE_TEXT_PARAM = "pasteText";

// A share is a link or a short list, never a document. The cap keeps a
// pathological GET (and the redirect Location header) well inside server
// header limits.
const MAX_SHARED_LENGTH = 4000;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().slice(0, MAX_SHARED_LENGTH);
}

function asHttpUrl(value: string): string | null {
  // A bare link only: anything with whitespace is text, not a URL.
  if (!value || /\s/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Where to send a share, or null when there is nothing usable in it (the
 * caller falls back to the dashboard).
 *
 * - a `url` that is an http(s) link opens the recipe dialog's import field;
 * - Android often puts the link in `text` instead (the page title goes in
 *   `title`), so a `text` that is just one link counts as a url too;
 * - any other `text` opens the shopping list's "Paste a list".
 *
 * `title` is never read: for a list share it is a heading, not an item, and
 * for a page share it adds nothing the link doesn't.
 */
export function resolveShareTarget(params: { text?: string | null; url?: string | null }): string | null {
  const text = clean(params.text);
  const link = asHttpUrl(clean(params.url)) ?? asHttpUrl(text);
  if (link) {
    return `/dashboard/meal-planning?tab=recipes&${SHARE_URL_PARAM}=${encodeURIComponent(link)}`;
  }
  if (text) {
    return `/dashboard/shopping-list?${SHARE_TEXT_PARAM}=${encodeURIComponent(text)}`;
  }
  return null;
}
