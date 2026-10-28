"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  primaryMobileNavItems,
  isNavItemActive,
  isMoreMenuActive,
  NAV_ICON_TILE_CLASSES,
  NAV_NEUTRAL_TILE_CLASS,
  NAV_NEUTRAL_TILE_ACTIVE_CLASS,
  type ShellDictionary,
} from "@/components/dashboard/nav-items";
import { LazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadBottomNavMoreMenu } from "@/components/dashboard/lazy-shell";
import { NotificationCountBadge } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
import type { Locale } from "@/lib/i18n/get-dictionary";

// Each streamed independently under its own Suspense boundary (see BottomNav
// below) so the notifications query doesn't block the bottom nav bar itself
// from painting — only the badge count and submenu entries pop in once ready.
function NotificationBadgeContent({
  notifications,
  className,
}: {
  notifications: Promise<NotificationItem[]>;
  className?: string;
}) {
  const items = use(notifications);
  return <NotificationCountBadge count={items.length} className={className} />;
}

export function BottomNav({
  dict,
  locale,
  notifications,
  unseenRelease,
  version,
}: {
  dict: ShellDictionary;
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
  unseenRelease: boolean;
  version: string;
}) {
  const pathname = usePathname();
  const moreActive = isMoreMenuActive(pathname);
  const [moreRequested, setMoreRequested] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // UX-150: publish the bar's real height (its labels grow with the text
  // size, so 3.75rem is only right at 100%) so floating buttons and <main>'s
  // bottom padding clear it instead of assuming a fixed value. The default
  // in globals.css covers the first paint.
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--bottom-nav-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--bottom-nav-h");
    };
  }, []);

  const moreClassName = cn(
    "relative z-10 flex min-w-0 flex-1 scale-100 flex-col items-center gap-0.5 pt-2 pb-1 text-xs font-medium transition-transform duration-150 ease-out active:scale-90",
    moreActive ? "text-primary" : "text-muted-foreground",
  );
  const moreContent = (
    <>
      <span
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          moreActive ? NAV_NEUTRAL_TILE_ACTIVE_CLASS : NAV_NEUTRAL_TILE_CLASS,
        )}
      >
        <MoreHorizontal className="size-5" />
        <Suspense fallback={null}>
          <NotificationBadgeContent
            notifications={notifications}
            className="-top-1.5 -right-1.5 h-4 min-w-4 px-0.5 text-xs leading-none"
          />
        </Suspense>
      </span>
      {/* Same label box as the links' (leading-tight), so the five labels
          share one baseline (UX-52). */}
      <span className="w-full truncate text-center leading-tight">{dict.nav.more}</span>
    </>
  );

  const totalItems = primaryMobileNavItems.length + 1;
  const primaryActiveIndex = primaryMobileNavItems.findIndex((item) => isNavItemActive(pathname, item.href));
  const activeIndex = primaryActiveIndex !== -1 ? primaryActiveIndex : moreActive ? primaryMobileNavItems.length : -1;

  return (
    // Standard bottom-nav pattern: `position: fixed` pinned to the true
    // viewport edge, with env(safe-area-inset-bottom) reserving room for
    // the home-indicator gesture area. dashboard/layout.tsx reserves
    // matching space at the bottom of `main`'s scroll content so page
    // content never sits underneath this bar.
    //
    // The inset is capped at 34px (min(2.125rem, env(...))) because iOS
    // standalone PWAs are documented to report an inflated/stale
    // safe-area-inset-bottom value right at launch, which only resolves to
    // the real ~34px home-indicator height after a reflow (e.g. a
    // rotation) — see
    // https://developer.apple.com/forums/thread/685481 and
    // https://developer.apple.com/forums/thread/744327. Capping avoids
    // that launch-time inflated value pushing the bar up with an
    // oversized gap beneath it.
    //
    // The view-transition-name keeps the bar still and on top while a page
    // or list animates underneath it (UX-33, see globals.css).
    <nav ref={navRef} className="fixed inset-x-0 bottom-0 z-40 border-t bg-background [view-transition-name:app-bottom-nav] pb-[min(2.125rem,env(safe-area-inset-bottom))] sm:hidden print:hidden">
      <div className="relative flex items-stretch justify-around">
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 rounded-xl bg-primary/10 transition-transform duration-300 ease-out"
          style={{
            width: `${100 / totalItems}%`,
            transform: `translateX(${activeIndex * 100}%)`,
            opacity: activeIndex === -1 ? 0 : 1,
          }}
        />
        {primaryMobileNavItems.map(({ href, key, icon: Icon, color }) => {
          const active = isNavItemActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative z-10 flex min-w-0 flex-1 scale-100 flex-col items-center gap-0.5 pt-2 pb-1 text-xs font-medium transition-transform duration-150 ease-out active:scale-90",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              {/* Every tab has a tile, and the active one keeps its section
                  hue (UX-52): only the neutral tabs (Overview) turn primary. */}
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  color
                    ? NAV_ICON_TILE_CLASSES[color]
                    : active
                      ? NAV_NEUTRAL_TILE_ACTIVE_CLASS
                      : NAV_NEUTRAL_TILE_CLASS,
                )}
              >
                <Icon className="size-5" />
              </span>
              {/* One line, ellipsis when the name outgrows its fifth of the bar (UX-150):
                  the old break-words hyphens-auto split names mid-word at 200%
                  text. The full name stays the link's accessible name. */}
              <span className="w-full truncate text-center leading-tight">{dict.nav[key]}</span>
            </Link>
          );
        })}
        {/* PERF-27: the menu behind this button is its own chunk (see
            bottom-nav-more-menu.tsx). Until it's mounted the button is a
            stand-in with the same look; a tap asks for the real one, which
            mounts with its menu already open. */}
        <LazyDialog
          loader={loadBottomNavMoreMenu}
          open={moreRequested}
          onLoadError={() => setMoreRequested(false)}
          fallback={
            <button
              type="button"
              aria-haspopup="menu"
              aria-current={moreActive ? "page" : undefined}
              className={moreClassName}
              onClick={() => setMoreRequested(true)}
              {...preloadOnIntent(loadBottomNavMoreMenu)}
            >
              {moreContent}
            </button>
          }
        >
          {(MoreMenu) => (
            <MoreMenu
              dict={dict}
              locale={locale}
              notifications={notifications}
              unseenRelease={unseenRelease}
              version={version}
              moreActive={moreActive}
              triggerClassName={moreClassName}
              triggerContent={moreContent}
            />
          )}
        </LazyDialog>
      </div>
    </nav>
  );
}
