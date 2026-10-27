/**
 * Builds a type guard for a fixed list of string literals, so a Select's
 * `onValueChange` (which hands back a plain `string | null`) can narrow to
 * the union instead of asserting it with `v as Union`. A value outside the
 * list narrows to false, which callers turn into their fallback.
 */
export function isOneOf<const T extends string>(values: readonly T[]): (value: unknown) => value is T {
  return (value): value is T => typeof value === "string" && (values as readonly string[]).includes(value);
}
