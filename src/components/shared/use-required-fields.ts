"use client";

import { useState, type FormEvent } from "react";

// UX-183b: required-field errors under the field, in the page's language,
// in place of the browser's own bubble (a Swedish user got "Please fill out
// this field." in English). The form is `noValidate`, calls `check` from its
// `onSubmit`, and clears a field's message as it is edited via `onInput`.
// A blocked submit calls `preventDefault`, which stops React running the
// form action, so nothing typed anywhere else is reset.
//
// The pattern is UX-183's (inventory add-item dialog) pulled out so the
// remaining forms don't each re-implement it.

export type RequiredRule = {
  /** The input's `name`, which is also the key the error is stored under. */
  name: string;
  /** The DOM id of the element that takes focus, and that `FieldError`
   * hangs off (`fieldErrorId(id)`). */
  id: string;
  message: string;
  /** A number input counts as missing when it isn't a finite number. */
  numeric?: boolean;
};

/** The rules whose field is empty (or, for `numeric`, not a number), in
 * rule order. Pure so it can be unit-tested without a DOM. */
export function findMissingFields(data: FormData, rules: readonly RequiredRule[]): RequiredRule[] {
  return rules.filter((rule) => {
    const value = String(data.get(rule.name) ?? "").trim();
    if (value === "") return true;
    return rule.numeric ? !Number.isFinite(Number(value)) : false;
  });
}

export function useRequiredFields() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clearField = (name: string) =>
    setErrors((current) => {
      if (!name || !(name in current)) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
    });
  return {
    errors,
    /** Error text for a field (by `name`), or undefined. */
    messageFor: (name: string) => errors[name],
    /** Call first in `onSubmit`. Returns true when the submit was blocked. */
    check(event: FormEvent<HTMLFormElement>, rules: readonly RequiredRule[]): boolean {
      const missing = findMissingFields(new FormData(event.currentTarget), rules);
      setErrors(Object.fromEntries(missing.map((rule) => [rule.name, rule.message])));
      if (missing.length === 0) return false;
      event.preventDefault();
      document.getElementById(missing[0].id)?.focus();
      return true;
    },
    /** Put on the `<form>`: editing a field clears its message. */
    onInput(event: FormEvent<HTMLFormElement>) {
      clearField((event.target as HTMLInputElement).name);
    },
    /** For a field whose `input` event doesn't carry its own `name` (a
     * combobox picking a suggestion): clear its message by hand. */
    clearField,
    clear: () => setErrors({}),
  };
}
