"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use } from "react";
import { Languages, MoreHorizontal, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  primaryMobileNavItems,
  overflowMobileNavItems,
  isNavItemActive,
  isMoreMenuActive,
  NAV_ICON_TILE_CLASSES,
  type ShellDictionary,
} from "@/components/dashboard/nav-items";
import { useLogout } from "@/lib/push-client";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { THEME_CHOICES } from "@/components/theme/theme-choice";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationCountBadge, NotificationMenuItem } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
import { CURRENT_VERSION } from "@/lib/release-notes";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

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

function NotificationMenuItemContent({
  notifications,
  dict,
}: {
  notifications: Promise<NotificationItem[]>;
  dict: Dictionary["notifications"];
}) {
  const items = use(notifications);
  return <NotificationMenuItem items={items} dict={dict} />;
}

export function BottomNav({
  dict,
  locale,
  notifications,
  unseenRelease,
}: {
  dict: ShellDictionary;
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
  unseenRelease: boolean;
}) {
  const pathname = usePathname();
  const moreActive = isMoreMenuActive(pathname);
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  // Label the toggle with the state it will switch *to* (matching the
  // locale toggle right next to it, which names the target locale rather
  // than the active one) instead of the currently active theme.
  const nextTheme = THEME_CHOICES[(THEME_CHOICES.indexOf(themeChoice) + 1) % THEME_CHOICES.length];
  const { next: nextLocale, toggle: toggleLocale } = useLocaleToggle(locale);
  const { logOut, pending: loggingOut } = useLogout();

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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background [view-transition-name:app-bottom-nav] pb-[min(2.125rem,env(safe-area-inset-bottom))] sm:hidden print:hidden">
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
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                  !active && color && NAV_ICON_TILE_CLASSES[color],
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="w-full text-center leading-tight break-words hyphens-auto">{dict.nav[key]}</span>
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-current={moreActive ? "page" : undefined}
                className={cn(
                  "relative z-10 flex flex-1 scale-100 flex-col items-center gap-0.5 pt-2 pb-1 text-xs font-medium transition-transform duration-150 ease-out active:scale-90",
                  moreActive ? "text-primary" : "text-muted-foreground",
                )}
              />
            }
          >
            <span className="relative inline-flex">
              <MoreHorizontal className="size-5" />
              <Suspense fallback={null}>
                <NotificationBadgeContent
                  notifications={notifications}
                  className="-top-1.5 -right-2 h-4 min-w-4 px-0.5 text-xs leading-none"
                />
              </Suspense>
            </span>
            {dict.nav.more}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56">
            {overflowMobileNavItems.map(({ href, key, icon: Icon, color }) => (
              <DropdownMenuItem key={href} className="min-w-0" render={<Link href={href} />}>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md",
                    color && NAV_ICON_TILE_CLASSES[color],
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 truncate">{dict.nav[key]}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-w-0" render={<Link href="/dashboard/whats-new" />}>
              <Sparkles className="size-4" />
              <span className="min-w-0 truncate">{dict.nav.whatsNew}</span>
              {unseenRelease && (
                <span className="size-2 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">{dict.nav.whatsNewUnseen}</span>
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">v{CURRENT_VERSION}</span>
            </DropdownMenuItem>
            <Suspense fallback={null}>
              <NotificationMenuItemContent notifications={notifications} dict={dict.notifications} />
            </Suspense>
            <DropdownMenuItem onClick={toggleLocale}>
              <Languages className="size-4" />
              {nextLocale === "sv" ? dict.language.swedish : dict.language.english}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={cycleTheme}>
              <ThemeIcon className="size-4" />
              {dict.theme[nextTheme]}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={loggingOut} onClick={logOut}>
              <LogOut className="size-4" />
              {dict.nav.logOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
