"use client";

// UX-33: list rows that move the moment they're tapped, and glide there.
//
// A tick, an untick or a delete changes the list at tap time (an urgent
// update, so it lands inside the 500 ms the browser's layout-shift metric
// leaves for a response to input). React only animates updates that run in
// a Transition with <ViewTransition>, never urgent ones, so list rows use
// the FLIP technique instead: after each commit this measures every row,
// compares it with where it was after the previous commit, and plays the
// difference back on the real element with the Web Animations API (First,
// Last, Invert, Play). Rows that arrive later from the server (an add, a
// change another member made) glide the same way.
//
// Because the animation runs on the real element, not on a snapshot the
// way a view transition does, a row stays tappable while it moves, at the
// place it's drawn.
//
// Rows opt in with `data-flip-key` (unique within the list, stable for the
// row: its id, or "label:..." for a section label). Keys pair across
// sections, so a ticked row that leaves "To buy" and appears under
// "Purchased" glides from one to the other.

import { useLayoutEffect, useRef } from "react";

// Where a row was: against its parent (what a move inside one list is
// measured in, unaffected by the page or a table scrolling) and in the
// viewport (for the rare move to another parent).
type Box = {
  el: HTMLElement;
  parent: HTMLElement | null;
  left: number;
  top: number;
  viewportLeft: number;
  viewportTop: number;
  width: number;
};

// A change this big (a search narrowing the inventory, a whole list
// completed) is a different list, not a few rows moving: no animation.
const BULK_CHANGE = 20;

function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tokenMs(name: string, fallback: number): number {
  const value = cssToken(name);
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.endsWith("ms") ? n : n * 1000;
}

function play(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation {
  try {
    return el.animate(keyframes, options);
  } catch {
    // An engine without CSS `linear()` easing (the spring) rejects it.
    return el.animate(keyframes, { ...options, easing: "ease-out" });
  }
}

/**
 * Returns a ref for the element holding the list (rows anywhere inside it
 * with `data-flip-key` take part). Give each list of rows `relative`, so a
 * removed row's fading copy can be placed in it.
 *
 * `view` names what the list is showing (a search, filters, a grouping).
 * When it changes the list is re-measured without animating: rows a search
 * hides haven't gone anywhere, and fading them out would only be noise.
 */
export function useFlipList<T extends HTMLElement>(view?: string) {
  const containerRef = useRef<T>(null);
  const previous = useRef<Map<string, Box> | null>(null);
  const previousView = useRef(view);

  // No dependency list on purpose: every commit of the list can move rows.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // A row still gliding from the last change starts over from its new
    // place rather than being measured mid-flight.
    for (const animation of container.getAnimations({ subtree: true })) {
      if (animation.id.startsWith("flip-")) animation.cancel();
    }

    const current = new Map<string, Box>();
    for (const el of container.querySelectorAll<HTMLElement>("[data-flip-key]")) {
      const rect = el.getBoundingClientRect();
      // The other layout's copy of a row (phone cards on desktop) is hidden.
      if (rect.width === 0 && rect.height === 0) continue;
      const parent = el.parentElement;
      const origin = parent?.getBoundingClientRect();
      current.set(el.dataset.flipKey!, {
        el,
        parent,
        // Relative to the parent's padding box, which is also where an
        // absolutely positioned copy of the row would go.
        left: rect.left - (origin?.left ?? 0) - (parent?.clientLeft ?? 0),
        top: rect.top - (origin?.top ?? 0) - (parent?.clientTop ?? 0),
        viewportLeft: rect.left,
        viewportTop: rect.top,
        width: rect.width,
      });
    }

    const before = previous.current;
    previous.current = current;
    const sameView = previousView.current === view;
    previousView.current = view;
    // The first render isn't a change, nor is a new view of the list, and
    // reduced motion means none at all.
    if (!before || !sameView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const entered = [...current.keys()].filter((key) => !before.has(key));
    const left = [...before.keys()].filter((key) => !current.has(key));
    if (entered.length + left.length > BULK_CHANGE) return;

    const fast = tokenMs("--motion-duration-fast", 120);
    const baseMs = tokenMs("--motion-duration-base", 200);
    const spring = tokenMs("--motion-duration-spring", 400);
    const springEase = cssToken("--motion-ease-spring") || "ease-out";
    const easeOut = cssToken("--motion-ease-out") || "ease-out";
    const easeIn = cssToken("--motion-ease-in") || "ease-in";

    for (const [key, now] of current) {
      const was = before.get(key);
      if (!was) {
        play(now.el, [{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], {
          id: "flip-enter",
          duration: baseMs,
          easing: easeOut,
          fill: "backwards",
        });
        continue;
      }
      const sameParent = was.parent === now.parent;
      const dx = sameParent ? was.left - now.left : was.viewportLeft - now.viewportLeft;
      const dy = sameParent ? was.top - now.top : was.viewportTop - now.viewportTop;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      play(now.el, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
        id: "flip-move",
        duration: spring,
        easing: springEase,
      });
    }

    // A removed row is already out of the DOM. Its node is put back in its
    // list, out of the flow and inert, just long enough to fade where it
    // was. Only into a list that's positioned (so the copy lands where the
    // row was) and still on the page; and not a table row, which on its own
    // doesn't lay out as one.
    for (const key of left) {
      const { el, parent, left: x, top: y, width } = before.get(key)!;
      if (el.tagName === "TR" || el.isConnected || !parent?.isConnected) continue;
      if (getComputedStyle(parent).position === "static") continue;
      Object.assign(el.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        margin: "0",
        pointerEvents: "none",
      });
      el.setAttribute("aria-hidden", "true");
      el.inert = true;
      parent.append(el);
      const exit = play(el, [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.96" }], {
        id: "flip-exit",
        duration: fast,
        easing: easeIn,
        fill: "forwards",
      });
      const remove = () => el.remove();
      exit.addEventListener("finish", remove);
      exit.addEventListener("cancel", remove);
    }
  });

  return containerRef;
}
