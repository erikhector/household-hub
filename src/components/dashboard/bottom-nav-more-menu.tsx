"use client";

import Link from "next/link";
import { Suspense, use } from "react";
import { Languages, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { overflowMobileNavItems, NAV_ICON_TILE_CLASSES, type ShellDictionary } from "@/components/dashboard/nav-items";
import { useLogout } from "@/lib/push-client";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { format } from "@/lib/i18n/format";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationMenuItem } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// PERF-27: the bottom bar's "More" menu, loaded on first use. bottom-nav.tsx
// keeps the five tabs and a stand-in for the More button in every page's
// chunk; this file is the dropdown behind it (the overflow links, language,
// theme and log out, with the hooks that drive them). It renders its own
// trigger from the same `triggerClassName` and `triggerContent` because a
// Base UI menu positions itself against the trigger inside its Root, and
// mounts open (`defaultOpen`) when the tap that asked for it was the first.

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

export function BottomNavMoreMenu({
  dict,
  locale,
  notifications,
  unseenRelease,
  version,
  moreActive,
  triggerClassName,
  triggerContent,
}: {
  dict: ShellDictionary;
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
  unseenRelease: boolean;
  version: string;
  moreActive: boolean;
  triggerClassName: string;
  triggerContent: React.ReactNode;
}) {
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  // UX-51: both shortcuts name the setting in use ("Theme: Dark", with the
  // matching icon); a tap still moves to the next one.
  const { toggle: toggleLocale } = useLocaleToggle(locale);
  const { logOut, pending: loggingOut } = useLogout();

  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger
        render={<button type="button" aria-current={moreActive ? "page" : undefined} className={triggerClassName} />}
      >
        {triggerContent}
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
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">v{version}</span>
        </DropdownMenuItem>
        <Suspense fallback={null}>
          <NotificationMenuItemContent notifications={notifications} dict={dict.notifications} />
        </Suspense>
        <DropdownMenuItem onClick={toggleLocale}>
          <Languages className="size-4" />
          {format(dict.language.current, { language: locale === "sv" ? dict.language.swedish : dict.language.english })}
        </DropdownMenuItem>
        {/* Stays open so light, dark and system are one tap each from
            where you are, not a reopen between every step. */}
        <DropdownMenuItem closeOnClick={false} onClick={cycleTheme}>
          <ThemeIcon className="size-4" />
          {format(dict.theme.current, { theme: dict.theme[themeChoice] })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={loggingOut} onClick={logOut}>
          <LogOut className="size-4" />
          {dict.nav.logOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
