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
