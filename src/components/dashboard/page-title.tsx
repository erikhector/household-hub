"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { commonCopy } from "@/lib/i18n/common";
import { getDocumentLocale } from "@/lib/i18n/client-locale";
import { COMPACT_TITLE_SLOT_ID, NAV_ACCENT_BAR_CLASSES, navItemForPath } from "@/components/dashboard/nav-items";
import { MorphTitle, type MorphKind } from "@/components/shared/view-transitions";

const subscribeNoop = () => () => {};

// UX-40: iOS-style large title. On a phone the page's H1 starts large in the
// page itself and scrolls away with the content; once it's gone, the same
// title appears in the existing top bar (over the household switcher, or at
// the top of the page for a single-household user, UX-158), so the
// user still knows where they are (DESIGN.md M7) without a second header
// eating the screen. Tapping the compact title scrolls back to the top, which
// also brings the household switcher back. On desktop the slot's header is
// `sm:hidden`, so this is just the H1.
export function PageTitle({
  children,
  morph,
  onTap,
  tapHint,
}: {
  children: ReactNode;
  /** UX-85: tapping the large title does something (a list's title opens
   * Rename). A pointer shortcut only: the same action must also sit in a
   * menu, since the heading itself isn't a tab stop. */
  onTap?: () => void;
  /** Tooltip for `onTap`, e.g. "Tap the title to rename". */
  tapHint?: string;
  /** UX-33: the list row whose title flies into this one (MorphTitle).
   * Only the large H1 takes part, never the compact copy in the bar. */
  morph?: { kind: MorphKind; id: string };
}) {
  // UX-52: the section's hue also marks its page, as a short accent bar
  // under the large title, so the colour on the bottom-bar tab means
  // something. Pages outside a coloured section (Overview, What's new) have
  // none. A bar under the title rather than a tile beside it: the title stays
  // on the page's gutter, aligned with the lists below it (UX-139). Only on
  // the section's own page: a detail page (a shopping list) needs its height
  // for rows (UX-79).
  const pathname = usePathname();
  const section = navItemForPath(pathname);
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

  const title = (
    <h1
      ref={titleRef}
      tabIndex={-1}
      onClick={onTap}
      title={onTap ? tapHint : undefined}
      // break-words: a long name (the overview greeting, an item) or a
      // long Swedish word at 200% text would otherwise widen the page.
      className={cn("font-heading text-2xl font-semibold tracking-tight break-words outline-none max-sm:text-3xl", onTap && "cursor-pointer")}
    >
      {children}
    </h1>
  );

  return (
    <>
      {morph ? (
        <MorphTitle kind={morph.kind} id={morph.id}>
          {title}
        </MorphTitle>
      ) : (
        title
      )}
      {section?.color && section.href === pathname && (
        <span
          aria-hidden="true"
          data-section-accent={section.color}
          className={cn("mt-1.5 mb-1 block h-1 w-8 rounded-full", NAV_ACCENT_BAR_CLASSES[section.color])}
        />
      )}
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
              // the switcher sat and the safe-area top stays clear. With a
              // switcher the header is as tall as that bar (min-h-full); a
              // single-household header has none (UX-158), so the bar brings
              // its own height and bottom rule and overlays the page's top.
              "absolute inset-x-0 top-0 flex min-h-full [[data-solo-household]_&]:border-b min-w-0 items-center gap-2 bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-left",
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
