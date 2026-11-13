// Plain, client-safe string helpers (no "server-only" — dictionary values
// are just data, so both Server and Client Components can format them).

export type PluralForms = { one: string; other: string };

export function plural(count: number, forms: PluralForms): string {
  return count === 1 ? forms.one : forms.other;
}

export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * The name a list gets when the user leaves the name blank: the prefix plus
 * today's date in the viewer's language — "Inköpslista — 5 okt. 2026",
 * "Shopping list — Oct 5, 2026" (UX-15). A bare toLocaleDateString() used
 * the runtime's default locale instead, so Swedish users got "10/5/2026".
 */
export function datedName(prefix: string, locale: string, date: Date = new Date()): string {
  return `${prefix} — ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date)}`;
}

/**
 * A computed decimal (a converted amount, a low-stock threshold) in the
 * viewer's decimal mark: "0,375" in Swedish, "0.375" in English (UX-187).
 * `String(n)` always gave the English point. Three significant digits by
 * default, the way the item page restates amounts in another unit; pass
 * more for a value the user typed, so it reads back as entered. Grouping
 * is off because these also pre-fill inputs, whose parsers read "1,240"
 * as 1.24, and the app's quantities are shown ungrouped elsewhere too.
 */
export function formatDecimal(value: number, locale: string, significantDigits = 3): string {
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: significantDigits, useGrouping: false }).format(value);
}
