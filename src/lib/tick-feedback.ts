"use client";

import { useState } from "react";

// UX-54: the shared "tick" moment. Ticking a shopping row, a dock row or a
// task used to remove it at once with nothing to show the tap landed. Now
// the checkbox fills with a short spring (TICK_MS, the `tick-pop` keyframes
// in globals.css), a 10 ms vibration fires where the device has one, and
// only then does the row move (`run`, the optimistic tick).
//
// Reduced motion (DESIGN.md principle 6) drops the wait and the spring but
// keeps the haptic: a vibration isn't motion, and it is the only feedback
// left. Unticking is never delayed: undoing should feel instant, and
// "earned" only applies to completing.

export const TICK_MS = 200;
export const TICK_VIBRATE_MS = 10;

/** A 10 ms buzz where the device supports it (not iOS Safari); silent elsewhere. */
export function vibrateTick(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(TICK_VIBRATE_MS);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fire the haptic, then call `run` once the checkbox has had TICK_MS to
 * fill (at once under reduced motion). Calls `onFilling` first when it
 * waits, so the caller can show the box filled meanwhile.
 */
export function startTickFeedback(run: () => void, onFilling?: () => void): void {
  vibrateTick();
  if (prefersReducedMotion()) {
    run();
    return;
  }
  onFilling?.();
  setTimeout(run, TICK_MS);
}

/**
 * Per-row tick feedback. `ticking` is true while the box fills, so the row
 * shows it checked (and plays the spring, via `data-ticking` on Checkbox)
 * before its state really changes. `tick(run)` is for completing; call
 * `run` directly to untick.
 */
export function useTickFeedback() {
  const [ticking, setTicking] = useState(false);
  const tick = (run: () => void) => {
    if (ticking) return;
    startTickFeedback(
      () => {
        setTicking(false);
        run();
      },
      () => setTicking(true),
    );
  };
  return { ticking, tick };
}
