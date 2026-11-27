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
// Lifting isn't enough on its own, either. iOS scrolls the focused field
// into view the moment it's tapped, measured against the sheet as it was
// *before* the keyboard (and so before the lift and the max-height cap in
// dialog.tsx that keeps a lifted sheet's top on screen). A field low in a
// tall sheet's body then ends up behind the keyboard or above the screen,
// so you type blind. `revealFocused` re-reveals the focused field once the
// keyboard is up: when it opens or grows (a taller keyboard — measured
// without offsetTop, so a pinch-zoom pan never counts), and when focus
// moves to another field while it's up. Not on every event: a pan or a
// repeat resize at the same height isn't a new keyboard, and re-revealing
// then would fight the user's own scrolling. The reveal itself waits for
// the sheet's max-height transition to finish (the band it measures moves
// until then) and keeps the field above DialogFooter, which is sticky and
// opaque on phones (`revealScrollDelta` below).
//
// The cap needs the visible height, not just the inset: iOS can pan the
// visual viewport down (offsetTop > 0, for a field under the keyboard or a
// pinch-zoom), and then `100dvh − inset` reaches up past the visible top
// by that pan. So while the keyboard is up the visual viewport's height is
// also written, as `--kb-visible`, and dialog.tsx caps the sheet with it.
//
// A CSS variable, not storage: nothing persists in the browser, so there's
// no cookie-inventory entry for this (AGENTS.md).

import { useEffect } from "react";

// Minimum gap that counts as a keyboard. On-screen keyboards are ~250-400px
// tall; anything smaller is noise — a dynamic browser toolbar (<100px),
// rounding, or a mid-animation transient — and must not lift the sheet
// (see the header comment).
const KEYBOARD_INSET_MIN_PX = 150;

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
  addEventListener(type: "resize" | "orientationchange" | "focusout" | "focusin", listener: () => void): void;
  removeEventListener(type: "resize" | "orientationchange" | "focusout" | "focusin", listener: () => void): void;
};

export function watchKeyboardInset(deps: {
  visualViewport: KeyboardViewport | null | undefined;
  windowTarget?: KeyboardWindow | null | undefined;
  innerHeight: () => number;
  setInset: (px: number) => void;
  clearInset: () => void;
  // The visible height while the keyboard is up, null when it's closed
  // (see the header comment; dialog.tsx falls back to 100dvh).
  setVisible?: (px: number | null) => void;
  // Bring the focused field back into view (see the header comment).
  revealFocused?: () => void;
}): () => void {
  const { visualViewport, windowTarget } = deps;
  // Desktops and browsers without the API: nothing to lift.
  if (!visualViewport) return () => {};
  // The last inset written (0 = keyboard closed), and the keyboard's own
  // height without the pan offset, so a reveal fires only when the
  // keyboard opens or grows, never for a pinch-zoom pan.
  let inset = 0;
  let keyboard = 0;
  const update = () => {
    const next = keyboardInsetPx(deps.innerHeight(), visualViewport.height, visualViewport.offsetTop);
    const nextKeyboard = next > 0 ? deps.innerHeight() - visualViewport.height : 0;
    const grew = nextKeyboard > keyboard;
    inset = next;
    keyboard = nextKeyboard;
    deps.setInset(next);
    deps.setVisible?.(next > 0 ? visualViewport.height : null);
    if (grew) deps.revealFocused?.();
  };
  // Focus moving between fields with the keyboard already up: no viewport
  // event fires, but the new field may sit behind the keyboard.
  const onFocusIn = () => {
    if (inset > 0) deps.revealFocused?.();
  };
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
  windowTarget?.addEventListener("focusin", onFocusIn);
  return () => {
    visualViewport.removeEventListener("resize", update);
    visualViewport.removeEventListener("scroll", update);
    windowTarget?.removeEventListener("resize", update);
    windowTarget?.removeEventListener("orientationchange", update);
    windowTarget?.removeEventListener("focusout", update);
    windowTarget?.removeEventListener("focusin", onFocusIn);
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
        clearInset: () => {
          document.documentElement.style.removeProperty("--kb-inset");
          document.documentElement.style.removeProperty("--kb-visible");
        },
        setVisible: (px) =>
          px === null
            ? document.documentElement.style.removeProperty("--kb-visible")
            : document.documentElement.style.setProperty("--kb-visible", `${px}px`),
        revealFocused,
      }),
    [],
  );
}

// How far (px) to scroll the sheet's body so a field sits inside the
// visible band, scrolling only as far as needed ("nearest"): positive
// scrolls down, negative up, 0 when it's already in view. The band is the
// body's box minus the sticky footer on phones, so a field revealed from
// below lands above Save/Cancel instead of under them. A field taller than
// the band lines up its top, where typing starts.
export function revealScrollDelta(
  field: { top: number; bottom: number },
  band: { top: number; bottom: number },
): number {
  if (field.top < band.top || field.bottom - field.top > band.bottom - band.top) return field.top - band.top;
  if (field.bottom > band.bottom) return field.bottom - band.bottom;
  return 0;
}

// Scrolls the focused field into the sheet's visible part. Only for a
// field inside a dialog's body: this hook exists for sheets, and a stray
// focus elsewhere isn't ours to scroll. The sheet's max-height (and lift)
// transition when --kb-inset changes, and the band moves until they
// settle, so this waits a frame (for the new value to start them) and
// then for the popup's running animations to finish before measuring.
// Scrolls the body by hand rather than scrollIntoView, which can also pan
// the page behind the sheet and doesn't know about the sticky footer.
// Longer than the sheet's slowest transition (the 320ms full-screen morph).
const REVEAL_WAIT_MAX_MS = 500;

function revealFocused(): void {
  requestAnimationFrame(() => {
    const popup = document.activeElement?.closest<HTMLElement>('[data-slot="dialog-content"]');
    if (!popup) return;
    // Capped, so an animation that never finishes (or a very slow motion
    // token) can't hold the reveal back for good.
    const settled = Promise.all(popup.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const cap = new Promise((resolve) => setTimeout(resolve, REVEAL_WAIT_MAX_MS));
    void Promise.race([settled, cap]).then(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return;
      const body = el.closest<HTMLElement>('[data-slot="dialog-body"]');
      if (!body || !popup.contains(body)) return;
      const box = body.getBoundingClientRect();
      const footer = body.querySelector<HTMLElement>('[data-slot="dialog-footer"]');
      const footerTop =
        footer && getComputedStyle(footer).position === "sticky" ? footer.getBoundingClientRect().top : box.bottom;
      const field = el.getBoundingClientRect();
      const delta = revealScrollDelta(field, { top: box.top, bottom: Math.min(box.bottom, footerTop) });
      if (delta !== 0) body.scrollTop += delta;
    });
  });
}
