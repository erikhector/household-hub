"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";
import { ChevronLeft, ChevronRight, Languages, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { navItems, isNavItemActive, NAV_ICON_TILE_CLASSES, SIDEBAR_COOKIE, type ShellDictionary } from "@/components/dashboard/nav-items";
import { useLogout } from "@/lib/push-client";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { THEME_CHOICES } from "@/components/theme/theme-choice";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
import { CURRENT_VERSION } from "@/lib/release-notes";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type HouseholdOption = { id: string; name: string; role: string };

// Unwraps the streamed notifications promise inside its own Suspense
// boundary (see Sidebar below) so the per-navigation notifications query
// doesn't block the rest of the sidebar from painting.
function NotificationBellContent({
  notifications,
  dict,
  expanded,
}: {
  notifications: Promise<NotificationItem[]>;
  dict: Dictionary["notifications"];
  expanded: boolean;
}) {
  const items = use(notifications);
  return <NotificationBell items={items} dict={dict} expanded={expanded} />;
}

export function Sidebar({
  defaultExpanded,
  current,
  households,
  dict,
  switcherDict,
  locale,
  notifications,
  unseenRelease,
}: {
  defaultExpanded: boolean;
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: ShellDictionary;
  switcherDict: Dictionary["household"]["switcher"];
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
  unseenRelease: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pathname = usePathname();
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  // Label the toggle with the state it will switch *to* (matching the
  // locale toggle right next to it, which names the target locale rather
  // than the active one) instead of the currently active theme.
  const nextTheme = THEME_CHOICES[(THEME_CHOICES.indexOf(themeChoice) + 1) % THEME_CHOICES.length];
  const { next: nextLocale, toggle: toggleLocale } = useLocaleToggle(locale);
  const { logOut, pending: loggingOut } = useLogout();

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  return (
    // h-dvh, not h-screen: the visible viewport on a phone or tablet, where
    // 100vh can run past the browser toolbar. On a short screen (`short:`,
    // a phone in landscape) the nav list and the six footer rows can't
    // share the height: scrolling just the nav left it a ~40 px window, so
    // the whole aside scrolls instead and the nav takes its natural height
    // (UX-7). box-content + the safe-area padding keeps w-56/w-16 as the
    // content width while clearing a landscape notch on the left.
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 box-content flex-col border-r bg-background pl-[env(safe-area-inset-left)] transition-[width] duration-150 sm:flex short:overflow-y-auto short:overscroll-contain print:hidden",
        expanded ? "w-56" : "w-16",
      )}
    >
      <div className={cn("flex items-center border-b px-2 py-3", !expanded && "justify-center")}>
        {expanded ? (
          <HouseholdSwitcher current={current} households={households} dict={switcherDict} />
        ) : (
          <span
            className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold"
            title={current.name}
          >
            {current.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 short:flex-none short:overflow-visible">
        {navItems.map(({ href, key, icon: Icon, color }) => {
          const active = isNavItemActive(pathname, href);
          const label = dict.nav[key];
          return (
            <Link
              key={href}
              href={href}
              title={expanded ? undefined : label}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                !expanded && "justify-center",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                  !active && color && NAV_ICON_TILE_CLASSES[color],
                )}
              >
                <Icon className="size-4 shrink-0" />
              </span>
              {expanded && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* Doubles as the app's version display. The dot stays until the
            user opens What's new for the newest release (see
            src/lib/release-notes/index.ts). */}
        <Link
          href="/dashboard/whats-new"
          title={expanded ? undefined : `${dict.nav.whatsNew} · v${CURRENT_VERSION}`}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors pointer-coarse:h-11",
            !expanded && "justify-center",
            isNavItemActive(pathname, "/dashboard/whats-new")
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <span className="relative inline-flex">
            <Sparkles className="size-4" />
            {unseenRelease && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary">
                <span className="sr-only">{dict.nav.whatsNewUnseen}</span>
              </span>
            )}
          </span>
          {expanded && (
            <>
              <span className="truncate">{dict.nav.whatsNew}</span>
              <span className="ml-auto text-xs tabular-nums">v{CURRENT_VERSION}</span>
            </>
          )}
        </Link>
        <Suspense fallback={<NotificationBell items={[]} dict={dict.notifications} expanded={expanded} />}>
          <NotificationBellContent notifications={notifications} dict={dict.notifications} expanded={expanded} />
        </Suspense>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleLocale}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
          title={dict.language.toggleLabel}
        >
          <Languages className="size-4" />
          {expanded && (nextLocale === "sv" ? dict.language.swedish : dict.language.english)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cycleTheme}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
          title={dict.theme.toggleLabel}
        >
          <ThemeIcon className="size-4" />
          {expanded && dict.theme[nextTheme]}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={logOut}
          disabled={loggingOut}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
          title={expanded ? undefined : dict.nav.logOut}
        >
          <LogOut className="size-4" />
          {expanded && dict.nav.logOut}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
          aria-label={expanded ? dict.nav.collapseSidebar : dict.nav.expandSidebar}
        >
          {expanded ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          {expanded && dict.nav.collapse}
        </Button>
      </div>
    </aside>
  );
}
