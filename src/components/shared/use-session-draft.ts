"use client";

// UX-211: a half-filled form that survives a reload (DESIGN.md M8). On a
// phone the usual mid-signup interruptions are a detour to the email app or
// a password manager, or an incoming call, and Android may discard the tab
// meanwhile: the reload that follows used to bring back an empty /signup.
//
// The draft lives in sessionStorage, so it ends with the tab and never
// reaches another one. Only the `names` passed in are written, read and
// restored: an explicit allowlist, so a password field is never listed and
// never stored. `key` is typed to the draft keys exported by
// src/lib/cookie-inventory.ts, so a draft can't be stored without being
// listed on the privacy page.
//
// The forms stay uncontrolled. Restoring writes each saved value into its
// empty field right after hydration, rather than through `defaultValue`,
// so it doesn't fight useKeptFormValues (UX-13) over the form's reset
// value, and a field the user already typed into before hydration keeps
// what they typed. Every storage call is wrapped: private browsing or
// blocked site data just means no draft.

import { useCallback, useEffect, useRef, type FormEvent } from "react";
import type { DraftStorageKey } from "@/lib/cookie-inventory";
import { pickFormValues } from "./use-kept-form-values";

/** The allowlisted string values in a stored draft; anything else is dropped. */
export function parseDraft<N extends string>(raw: string | null, names: readonly N[]): Partial<Record<N, string>> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const draft: Partial<Record<N, string>> = {};
  for (const name of names) {
    const value = (parsed as Record<string, unknown>)[name];
    if (typeof value === "string" && value !== "") draft[name] = value;
  }
  return draft;
}

export function useSessionDraft<N extends string>(key: DraftStorageKey, names: readonly N[]) {
  const formRef = useRef<HTMLFormElement>(null);
  // `names` is a literal at each call site; a ref keeps the callbacks stable.
  const namesRef = useRef(names);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      return;
    }
    const draft = parseDraft(raw, namesRef.current);
    for (const name of namesRef.current) {
      const field = form.elements.namedItem(name);
      const value = draft[name];
      if (field instanceof HTMLInputElement && value !== undefined && field.value === "") field.value = value;
    }
  }, [key]);

  const onInput = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const values = pickFormValues(new FormData(event.currentTarget), namesRef.current);
      try {
        sessionStorage.setItem(key, JSON.stringify(values));
      } catch {
        // Storage unavailable: nothing to keep, the form still works.
      }
    },
    [key],
  );

  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Nothing was stored.
    }
  }, [key]);

  return { formRef, onInput, clear };
}
