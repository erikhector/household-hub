"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "@/components/dashboard/nav-items";
import { logoutAction } from "@/lib/actions/auth";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationCountBadge, NotificationMenuItem } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export function BottomNav({
  dict,
  locale,
  notifications,
}: {
  dict: Dictionary;
  locale: Locale;
  notifications: NotificationItem[];
}) {
  const pathname = usePathname();
  const moreActive = overflowMobileNavItems.some((item) => isNavItemActive(pathname, item.href));
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  const { next: nextLocale, toggle: toggleLocale } = useLocaleToggle(locale);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background sm:hidden">
      <div className="flex items-stretch justify-around pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {primaryMobileNavItems.map(({ href, key, icon: Icon }) => {
          const active = isNavItemActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {dict.nav[key]}
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-medium",
                  moreActive ? "text-primary" : "text-muted-foreground",
                )}
              />
            }
          >
            <span className="relative inline-flex">
              <MoreHorizontal className="size-5" />
              <NotificationCountBadge
                count={notifications.length}
                className="-top-1 -right-1 size-3.5 text-[9px]"
              />
            </span>
            {dict.nav.more}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8}>
            {overflowMobileNavItems.map(({ href, key, icon: Icon }) => (
              <DropdownMenuItem key={href} render={<Link href={href} />}>
                <Icon className="size-4" />
                {dict.nav[key]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <NotificationMenuItem items={notifications} dict={dict.notifications} />
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
