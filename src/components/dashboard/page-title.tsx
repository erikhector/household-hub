"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { commonCopy } from "@/lib/i18n/common";
import { getDocumentLocale } from "@/lib/i18n/client-locale";
import { COMPACT_TITLE_SLOT_ID } from "@/components/dashboard/nav-items";

const subscribeNoop = () => () => {};

// UX-40: iOS-style large title. On a phone the page's H1 starts large in the
// page itself and scrolls away with the content; once it's gone, the same
// title appears in the existing top bar (over the household switcher), so the
// user still knows where they are (DESIGN.md M7) without a second header
// eating the screen. Tapping the compact title scrolls back to the top, which
// also brings the household switcher back. On desktop the slot's header is
// `sm:hidden`, so this is just the H1.
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // The portal target only exists in the browser; reading it through
  // useSyncExternalStore keeps the server render and hydration identical
  // (no compact bar) and picks the slot up right after.
  const slot = useSyncExternalStore(
    subscribeNoop,
    () => document.getElementById(COMPACT_TITLE_SLOT_ID),
    () => null,
  );

  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    // Only the phone shell has the bar to collapse into, and only there
    // does `main` scroll; on desktop the document scrolls, and the title
    // leaving the screen must not mount a hidden copy of it.
    const phone = window.matchMedia("(max-width: 639.98px)");
    let titleGone = false;
    const update = () => setCollapsed(phone.matches && titleGone);
    // Root is the viewport: on phones `main` clips the title, so it stops
    // intersecting as it passes under the top bar. Only "gone above"
    // counts; a title pushed below the fold (a landscape keyboard can do
    // that) shouldn't collapse anything.
    const observer = new IntersectionObserver(([entry]) => {
      const viewportHeight = entry.rootBounds?.height ?? window.innerHeight;
      titleGone = !entry.isIntersecting && entry.boundingClientRect.top < viewportHeight / 2;
      update();
    });
    observer.observe(title);
    phone.addEventListener("change", update);
    return () => {
      observer.disconnect();
      phone.removeEventListener("change", update);
    };
  }, []);

  function backToTop() {
    const title = titleRef.current;
    if (!title) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Focus first (without scrolling) so keyboard and screen-reader users land
    // on the title instead of on <body> when this button unmounts.
    title.focus({ preventScroll: true });
    title.closest("main")?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <>
      <h1
        ref={titleRef}
        tabIndex={-1}
        className={cn(
          "font-heading text-2xl font-semibold tracking-tight outline-none max-sm:text-3xl",
          className,
        )}
      >
        {children}
      </h1>
      {/* Mounted only while collapsed, so the title isn't in the DOM twice
          the rest of the time (nor ever on desktop, where the slot's
          header is hidden and the document, not main, scrolls). It fades
          in through `starting:` (@starting-style) and simply goes away. */}
      {slot &&
        collapsed &&
        createPortal(
          <button
            type="button"
            onClick={backToTop}
            className={cn(
              // Same padding as the header it covers, so the title sits where
              // the switcher sat and the safe-area top stays clear.
              "absolute inset-0 flex min-w-0 items-center gap-2 bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-left",
              "transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none",
            )}
          >
            <span className="min-w-0 flex-1 truncate font-heading text-lg font-semibold tracking-tight">
              {children}
            </span>
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{commonCopy[getDocumentLocale()].backToTop}</span>
          </button>,
          slot,
        )}
    </>
  );
}
