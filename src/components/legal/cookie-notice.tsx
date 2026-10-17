"use client";

// Informational (not consent) notice: every cookie/localStorage entry the app
// uses is either strictly necessary or a preference the user set themselves
// — see src/lib/cookie-inventory.ts — so there's nothing to opt out of and
// no consent gate. Non-blocking by design: the app is fully usable without
// dismissing it. If a non-exempt cookie (analytics, marketing, third-party)
// is ever added, this must be replaced by a real consent flow first.
//
// `acknowledged` is read server-side from the ack cookie in the root layout
// (same pattern as the sidebar cookie in DashboardLayout), so a returning
// visitor never sees a flash of the notice before hydration.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COOKIE_NOTICE_COOKIE, COOKIE_NOTICE_COOKIE_MAX_AGE } from "@/lib/cookie-inventory";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function CookieNotice({
  dict,
  acknowledged,
}: {
  dict: Dictionary["cookieNotice"];
  acknowledged: boolean;
}) {
  const [dismissed, setDismissed] = useState(acknowledged);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // The notice is fixed, so the page can't see it: publish its size as CSS
  // variables and let the layouts reserve that room (UX-57), so it never
  // covers a submit button, the footer's language toggle or the floating
  // primary action. `--cookie-notice-space` is for public pages (body
  // padding, measured from the viewport bottom so the sm+ card's offset
  // counts); `--cookie-notice-h` is for the dashboard, whose scrolling
  // column already clears the BottomNav and only needs the strip's own
  // height on a phone. Both are removed once it is dismissed.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => {
      const rect = el.getBoundingClientRect();
      root.style.setProperty("--cookie-notice-space", `${Math.ceil(window.innerHeight - rect.top)}px`);
      root.style.setProperty("--cookie-notice-h", `${Math.ceil(rect.height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--cookie-notice-space");
      root.style.removeProperty("--cookie-notice-h");
    };
  }, [dismissed, pathname]);

  if (dismissed) return null;

  // On phone-width dashboard pages the fixed BottomNav (z-40, 3.75rem tall
  // plus the home-indicator inset, as in the dashboard layout) occupies the
  // bottom edge, so sit above it rather than covering the primary navigation.
  const aboveBottomNav = pathname.startsWith("/dashboard");

  function acknowledge() {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NOTICE_COOKIE}=1; path=/; max-age=${COOKIE_NOTICE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    setDismissed(true);
  }

  // A quiet strip, not a card: it only reports strictly necessary cookies, so
  // on a phone it is one slim full-width bar with an outline button (never a
  // second filled primary next to the page's own). From sm it is the
  // floating card it always was.
  return (
    <div
      ref={ref}
      role="region"
      aria-label={dict.title}
      className={cn(
        "fixed inset-x-0 z-40 flex print:hidden items-center gap-2 border-t bg-popover px-3 py-1 text-xs text-popover-foreground sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:gap-3 sm:rounded-xl sm:border sm:p-4 sm:text-sm sm:shadow-lg",
        aboveBottomNav
          ? "bottom-[calc(3.75rem+min(2.125rem,env(safe-area-inset-bottom)))]"
          : "bottom-0 pb-[max(0.25rem,env(safe-area-inset-bottom))]",
      )}
    >
      <p className="flex-1 leading-snug text-muted-foreground">
        {dict.message}{" "}
        <Link href="/privacy#cookies" className="touch-target text-foreground underline underline-offset-4">
          {dict.learnMore}
        </Link>
      </p>
      <Button variant="outline" size="sm" onClick={acknowledge} className="shrink-0 max-sm:min-h-11">
        {dict.dismiss}
      </Button>
    </div>
  );
}
