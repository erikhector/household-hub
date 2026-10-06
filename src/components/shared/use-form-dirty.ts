"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * UX-24: a settings card's save button is only the view's call to action
 * once there is something to save. `dirty` is true while any visible input
 * in the form differs from its `defaultValue` (empty for password fields),
 * so the card can render its button `secondary` until then and `default`
 * after.
 *
 * Read off the DOM on each input rather than mirrored into state per field,
 * so the forms stay plain uncontrolled Server Action forms. It is read again
 * whenever `pending` flips: a settled action resets the form to its
 * (possibly new) defaults, so a saved card goes back to `secondary`, while a
 * rejected one that kept what was typed stays solid.
 */
export function useFormDirty(pending: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  const recheck = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    setDirty(
      Array.from(form.elements).some(
        (el) => el instanceof HTMLInputElement && el.type !== "hidden" && el.value !== el.defaultValue,
      ),
    );
  }, []);

  useEffect(() => {
    // Deferred so it reads the form after React has reset it and the
    // refreshed `defaultValue`s have landed.
    const timer = setTimeout(recheck, 0);
    return () => clearTimeout(timer);
  }, [pending, recheck]);

  return { dirty, formProps: { ref: formRef, onInput: recheck } };
}
