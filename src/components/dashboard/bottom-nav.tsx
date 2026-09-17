"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use } from "react";
import { Languages, MoreHorizontal, LogOut } from "lucide-react";
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
  NAV_ICON_TILE_CLASSES,
} from "@/components/dashboard/nav-items";
import { logoutAction } from "@/lib/actions/auth";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationCountBadge, NotificationMenuItem } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
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
}: {
  dict: Dictionary;
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
}) {
  const pathname = usePathname();
  const moreActive = overflowMobileNavItems.some((item) => isNavItemActive(pathname, item.href));
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  const { next: nextLocale, toggle: toggleLocale } = useLocaleToggle(locale);

  const totalItems = primaryMobileNavItems.length + 1;
  const primaryActiveIndex = primaryMobileNavItems.findIndex((item) => isNavItemActive(pathname, item.href));
  const activeIndex = primaryActiveIndex !== -1 ? primaryActiveIndex : moreActive ? primaryMobileNavItems.length : -1;

  return (
    // Fixed to the viewport's bottom edge rather than living in normal flow —
    // see dashboard/layout.tsx's `main` for the matching reserved bottom
    // padding so scrolled content never ends up hidden underneath it.
    //
    // pb-[env(safe-area-inset-bottom)] isn't just for keeping the icons off
    // the home indicator: on real iOS standalone/PWA, a fixed element whose
    // box doesn't itself reserve that inset can leave the safe-area strip
    // unpainted by its own background, showing the page's background
    // through underneath instead — the same class of bug already hit (and
    // fixed) for body's background, see globals.css. Without this padding
    // that showed up as a visible gap under the nav on-device.
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden">
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
              className={cn(
                "relative z-10 flex min-w-0 flex-1 scale-100 flex-col items-center gap-0.5 pt-2 pb-1 text-[0.65rem] font-medium transition-transform duration-150 ease-out active:scale-90",
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
              <span className="w-full text-center leading-tight break-words">{dict.nav[key]}</span>
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  "relative z-10 flex flex-1 scale-100 flex-col items-center gap-0.5 pt-2 pb-1 text-[0.65rem] font-medium transition-transform duration-150 ease-out active:scale-90",
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
                  className="-top-1 -right-1 size-3.5 text-[9px]"
                />
              </Suspense>
            </span>
            {dict.nav.more}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8}>
            {overflowMobileNavItems.map(({ href, key, icon: Icon, color }) => (
              <DropdownMenuItem key={href} render={<Link href={href} />}>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md",
                    color && NAV_ICON_TILE_CLASSES[color],
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                {dict.nav[key]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <Suspense fallback={null}>
              <NotificationMenuItemContent notifications={notifications} dict={dict.notifications} />
            </Suspense>
            <DropdownMenuItem onClick={toggleLocale}>
              <Languages className="size-4" />
              {nextLocale === "sv" ? dict.language.swedish : dict.language.english}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={cycleTheme}>
              <ThemeIcon className="size-4" />
              {dict.theme[themeChoice]}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => logoutAction()}>
              <LogOut className="size-4" />
              {dict.nav.logOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
