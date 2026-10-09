"use client";

// UX-12 — keeps a bottom sheet's Save reachable while the on-screen keyboard
// is open (DESIGN.md M2, thumb zone). Two halves:
//
// - Android: `viewport.interactiveWidget: "resizes-content"` in
//   src/app/layout.tsx shrinks the layout viewport above the keyboard, so
//   the sheet (max-h-[85dvh], bottom-0) rides up on its own.
// - iOS: Safari keeps the layout viewport full-height behind the keyboard
//   and ignores interactiveWidget, so the sheet needs lifting by hand. The
//   visual viewport *does* shrink there, and the gap between it and the
//   layout viewport is the keyboard's height. DialogContent reads it from
//   `--kb-inset` (dialog.tsx), and `useKeyboardInset` below keeps that
//   variable current.
//
// A CSS variable, not storage: nothing persists in the browser, so there's
// no cookie-inventory entry for this (AGENTS.md).

import { useEffect } from "react";

// The keyboard's height in CSS px: how much shorter (and, under pinch-zoom,
// how far down) the visual viewport is than the layout viewport. Clamped at
// zero so a taller visual viewport (desktop devtools quirks, rounding) never
// pushes the sheet down past the screen edge.
export function keyboardInsetPx(innerHeight: number, viewportHeight: number, viewportOffsetTop = 0): number {
  return Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
}

// The slice of VisualViewport the wiring needs. Kept structural (rather than
// typing `window.visualViewport` directly) so the node-environment unit test
// (vitest.config.ts has no jsdom, by design) can drive it with a fake.
export type KeyboardViewport = {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
};

export function watchKeyboardInset(deps: {
  visualViewport: KeyboardViewport | null | undefined;
  innerHeight: () => number;
  setInset: (px: number) => void;
  clearInset: () => void;
}): () => void {
  const { visualViewport } = deps;
  // Desktops and browsers without the API: nothing to lift.
  if (!visualViewport) return () => {};
  const update = () =>
    deps.setInset(keyboardInsetPx(deps.innerHeight(), visualViewport.height, visualViewport.offsetTop));
  // Set once up front (a keyboard already open when the dialog mounts) and
  // on every change after: `resize` for the keyboard opening/closing,
  // `scroll` for pinch-zoom pans, which move offsetTop.
  update();
  visualViewport.addEventListener("resize", update);
  visualViewport.addEventListener("scroll", update);
  return () => {
    visualViewport.removeEventListener("resize", update);
    visualViewport.removeEventListener("scroll", update);
    deps.clearInset();
  };
}

// Mounted by DialogContent, so the listeners only exist while a dialog is
// open — the only time a sheet can sit behind the keyboard.
export function useKeyboardInset(): void {
  useEffect(
    () =>
      watchKeyboardInset({
        visualViewport: window.visualViewport,
        innerHeight: () => window.innerHeight,
        setInset: (px) => document.documentElement.style.setProperty("--kb-inset", `${px}px`),
        clearInset: () => document.documentElement.style.removeProperty("--kb-inset"),
      }),
    [],
  );
}
