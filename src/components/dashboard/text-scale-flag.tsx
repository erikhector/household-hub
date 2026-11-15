"use client";

import { useEffect, useRef } from "react";

// UX-160: past this root font-size (px) the text is above 150 % of the 16 px
// default, and controls that only fit at normal sizes drop to their compact
// form (the floating primary action to its icon, the smart-add icons to a
// fixed 44 px).
const LARGE_TEXT_ROOT_PX = 24;

/**
 * Mirrors "text is larger than 150 %" onto <html data-large-text>, which
 * Tailwind reads as the `large-text:` variant (globals.css). A probe one
 * `rem` wide is the measuring stick: its width is the root font-size in px
 * whatever set it (the OS font scale, or a test's `html { font-size: 200% }`),
 * and a ResizeObserver reports when that changes without polling.
 */
export function TextScaleFlag() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = probe.current;
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.toggleAttribute("data-large-text", el.getBoundingClientRect().width > LARGE_TEXT_ROOT_PX);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeAttribute("data-large-text");
    };
  }, []);
  return <span ref={probe} aria-hidden="true" className="pointer-events-none invisible absolute h-px w-[1rem]" />;
}
