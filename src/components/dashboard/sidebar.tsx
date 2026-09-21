"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";
import { ChevronLeft, ChevronRight, Languages, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { navItems, isNavItemActive, NAV_ICON_TILE_CLASSES, SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { logoutAction } from "@/lib/actions/auth";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { useLocaleToggle } from "@/components/language/use-locale-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { NotificationItem } from "@/lib/notifications";
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
  locale,
  notifications,
}: {
  defaultExpanded: boolean;
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: Dictionary;
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pathname = usePathname();
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  const { next: nextLocale, toggle: toggleLocale } = useLocaleToggle(locale);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-background transition-[width] duration-150 sm:flex",
        expanded ? "w-56" : "w-16",
      )}
    >
      <div className={cn("flex items-center border-b px-2 py-3", !expanded && "justify-center")}>
        {expanded ? (
          <HouseholdSwitcher current={current} households={households} dict={dict} />
        ) : (
          <span
            className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold"
            title={current.name}
          >
            {current.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {navItems.map(({ href, key, icon: Icon, color }) => {
          const active = isNavItemActive(pathname, href);
          const label = dict.nav[key];
          return (
            <Link
              key={href}
              href={href}
              title={expanded ? undefined : label}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
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
      <div className="flex flex-col gap-1 border-t p-2">
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
          {expanded && dict.theme[themeChoice]}
        </Button>
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
            title={expanded ? undefined : dict.nav.logOut}
          >
            <LogOut className="size-4" />
            {expanded && dict.nav.logOut}
          </Button>
        </form>
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
