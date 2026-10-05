export const locales = ["en", "sv"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "locale";

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

// Picks the best supported locale from an `Accept-Language` header, for a
// visitor with no `locale` cookie and no account yet (see getLocale()). Tags
// are ranked by their q-value (default 1, ties keep header order) and
// matched on the primary subtag, so `sv-SE` and `sv` both give `sv`. A
// header naming only unsupported languages (or none) gives the default.
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      const weight = q === undefined ? 1 : Number(q);
      return { primary: tag.trim().toLowerCase().split("-")[0], weight, index };
    })
    .filter((entry) => entry.weight > 0 && Number.isFinite(entry.weight))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { primary } of ranked) {
    if (isLocale(primary)) return primary;
  }
  return defaultLocale;
}
