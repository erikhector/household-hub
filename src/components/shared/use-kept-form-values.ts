"use client";

import { useState, type FormEvent } from "react";

/**
 * The string values of `names` in a submitted form, skipping any field that
 * isn't there (a disabled input, an unchecked box) or is a File.
 */
export function pickFormValues<N extends string>(
  formData: FormData,
  names: readonly N[],
): Partial<Record<N, string>> {
  const values: Partial<Record<N, string>> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

/** `values` narrowed to `names` — what `keep` leaves remembered. */
export function keepOnly<N extends string>(
  values: Partial<Record<N, string>>,
  names: readonly N[],
): Partial<Record<N, string>> {
  const kept: Partial<Record<N, string>> = {};
  for (const name of names) {
    if (values[name] !== undefined) kept[name] = values[name];
  }
  return kept;
}

/**
 * UX-13: React 19 resets an uncontrolled form once its action settles —
 * including when the action came back with `{ error }`, which wiped what the
 * user had typed right when they need to fix one field and resubmit. A
 * reset puts each field back to its `defaultValue`, so this remembers the
 * submitted values (at submit time, before the action runs) and the form
 * feeds them back in as `defaultValue={values.email ?? fallback}`: the
 * reset then lands on what the user typed instead of a blank.
 *
 * Done client-side rather than by echoing values in the action state, so
 * the forms keep their plain Server Action (and its no-JS fallback) and no
 * action's return type changes. `names` is an explicit allowlist: password
 * fields are never listed, so a password is never held in state and still
 * clears after a failed submit, as users expect.
 *
 * `onSubmit` doesn't call `preventDefault`, so the form's `action` still
 * runs. Call `reset` when a dialog reopens so it starts from its own
 * defaults again rather than the last attempt. Call `keep(names)` from a
 * successful action that leaves the form open, to carry only those fields
 * into the next entry: the rest go back to their own defaults with the
 * reset that follows.
 */
export function useKeptFormValues<N extends string>(names: readonly N[]) {
  const [values, setValues] = useState<Partial<Record<N, string>>>({});
  return {
    values,
    onSubmit: (event: FormEvent<HTMLFormElement>) =>
      setValues(pickFormValues(new FormData(event.currentTarget), names)),
    reset: () => setValues({}),
    keep: (keepNames: readonly N[]) => setValues((current) => keepOnly(current, keepNames)),
  };
}
