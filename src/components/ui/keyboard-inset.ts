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
// Small gaps are ignored, not lifted (KEYBOARD_INSET_MIN_PX): sub-keyboard
// gaps come from several places — the browser's dynamic toolbar
// showing/hiding (~50-60px with no keyboard open), rounding, and transient
// geometry mid-way through a keyboard open/close animation, where the layout
// and visual viewports settle on different frames. Lifting the sheet by one
// of those leaves a see-through notch between the sheet and the screen
// bottom. Keyboards are ~250-400px, so anything below the threshold is
// noise, not a keyboard.
//
// A stale inset is the other half of the notch, and the one that fits
// all-devices/all-drawers: `--kb-inset` lives on documentElement and is
// only cleared when the dialog unmounts, so when the LAST viewport event of
// a keyboard close captures a transient small gap — or the close event is
// dropped entirely — the sheet stays lifted by tens of px with no trailing
// event to correct it, in every drawer once any keyboard has been used.
// Blur is the reliable half of dismissal, so `watchKeyboardInset` also
// recomputes on window `focusout`, plus window `resize`/`orientationchange`
// for rotations and layout settles the viewport events can miss. Each
// recompute with the keyboard closed overwrites any stale value with 0:
// self-healing. Trade-off, stated plainly: a recompute re-reads geometry,
// so if the viewport hasn't settled yet at that instant the stale value
// survives until the next signal or unmount; the threshold above at least
// keeps partial-transition gaps from lifting the sheet.
//
// A CSS variable, not storage: nothing persists in the browser, so there's
// no cookie-inventory entry for this (AGENTS.md).

import { useEffect } from "react";

// Minimum gap that counts as a keyboard. On-screen keyboards are ~250-400px
// tall; anything smaller is noise — a dynamic browser toolbar (<100px),
// rounding, or a mid-animation transient — and must not lift the sheet
// (see the header comment).
export const KEYBOARD_INSET_MIN_PX = 150;

// The keyboard's height in CSS px: how much shorter (and, under pinch-zoom,
// how far down) the visual viewport is than the layout viewport. Clamped at
// zero so a taller visual viewport (desktop devtools quirks, rounding) never
// pushes the sheet down past the screen edge, and gated on
// KEYBOARD_INSET_MIN_PX so a sub-keyboard gap reads as closed.
export function keyboardInsetPx(innerHeight: number, viewportHeight: number, viewportOffsetTop = 0): number {
  const gap = innerHeight - viewportHeight - viewportOffsetTop;
  if (gap < KEYBOARD_INSET_MIN_PX) return 0;
  return gap;
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

// The slice of Window the wiring needs for end-of-transition signals (see
// the header comment): `resize`/`orientationchange` for rotations and layout
// settles the visualViewport events can miss, `focusout` for keyboard
// dismissal, whose blur half is reliable even when the matching viewport
// resize is dropped. Same structural trick as KeyboardViewport so the
// node-environment test drives it with a fake.
export type KeyboardWindow = {
  addEventListener(type: "resize" | "orientationchange" | "focusout", listener: () => void): void;
  removeEventListener(type: "resize" | "orientationchange" | "focusout", listener: () => void): void;
};

export function watchKeyboardInset(deps: {
  visualViewport: KeyboardViewport | null | undefined;
  windowTarget?: KeyboardWindow | null | undefined;
  innerHeight: () => number;
  setInset: (px: number) => void;
  clearInset: () => void;
}): () => void {
  const { visualViewport, windowTarget } = deps;
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
  // Self-healing: each of these recomputes, so with the keyboard closed any
  // stale value is overwritten with 0 (header comment for the mechanism).
  windowTarget?.addEventListener("resize", update);
  windowTarget?.addEventListener("orientationchange", update);
  windowTarget?.addEventListener("focusout", update);
  return () => {
    visualViewport.removeEventListener("resize", update);
    visualViewport.removeEventListener("scroll", update);
    windowTarget?.removeEventListener("resize", update);
    windowTarget?.removeEventListener("orientationchange", update);
    windowTarget?.removeEventListener("focusout", update);
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
        windowTarget: window,
        innerHeight: () => window.innerHeight,
        setInset: (px) => document.documentElement.style.setProperty("--kb-inset", `${px}px`),
        clearInset: () => document.documentElement.style.removeProperty("--kb-inset"),
      }),
    [],
  );
}
