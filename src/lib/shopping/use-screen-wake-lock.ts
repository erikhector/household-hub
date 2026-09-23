"use client";

// AUTO-3 — keeps a phone's screen on while a shopping list is open and
// ACTIVE, so it doesn't dim or lock mid-aisle. The Screen Wake Lock API
// needs no permission prompt (unlike, say, notifications or the camera), so
// there's nothing to ask the user and nothing to disclose — it either works
// or it silently doesn't. Stores nothing in the browser, so there's no
// cookie-inventory entry for this.

import { useEffect } from "react";

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    // Feature-detect rather than call-and-catch only: older Safari, and any
    // non-secure context, simply don't have `navigator.wakeLock` at all.
    if (!("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestLock = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied, backgrounded tab, battery saver, unsupported combination
        // of browser/OS — all silently skipped. This is a convenience, not
        // a feature the user opted into, so it never surfaces an error.
      }
    };

    if (document.visibilityState === "visible") void requestLock();

    // The platform itself releases the lock whenever the tab is hidden, so
    // re-request it the moment the tab (and this list) is visible again.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !sentinel && !cancelled) void requestLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
