"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, use, useState } from "react";
import { ChevronLeft, ChevronRight, Languages, LogOut, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { navItems, isNavItemActive, NAV_ICON_TILE_CLASSES, SIDEBAR_COOKIE, type ShellDictionary } from "@/components/dashboard/nav-items";
import { useLogout } from "@/lib/push-client";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { format } from "@/lib/i18n/format";
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
  active,
}: {
  notifications: Promise<NotificationItem[]>;
  dict: Dictionary["notifications"];
  expanded: boolean;
  active: boolean;
}) {
  const items = use(notifications);
  return <NotificationBell items={items} dict={dict} expanded={expanded} active={active} />;
}

// A footer action. Collapsed, it is an icon alone: `aria-label` names it for
// screen readers and the Tooltip shows it on hover/focus, since a `title`
// never appears on touch (UX-27). Expanded, the visible text is the name
// (`alwaysNamed` keeps the aria-label for the collapse toggle, whose visible
// text is the shorter "Collapse").
function FooterButton({
  label,
  text,
  expanded,
  onClick,
  disabled,
  alwaysNamed,
  children,
}: {
  label: string;
  text: string;
  expanded: boolean;
  onClick: () => void;
  disabled?: boolean;
  alwaysNamed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip
      label={label}
      disabled={expanded}
      render={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={expanded && !alwaysNamed ? undefined : label}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
        />
      }
    >
      {children}
      {expanded && text}
    </Tooltip>
  );
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
  version,
}: {
  defaultExpanded: boolean;
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: ShellDictionary;
  switcherDict: Dictionary["household"]["switcher"];
  locale: Locale;
  notifications: Promise<NotificationItem[]>;
  unseenRelease: boolean;
  version: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pathname = usePathname();
  // The footer pages aren't in navItems, so they mark themselves (UX-27).
  const whatsNewActive = isNavItemActive(pathname, "/dashboard/whats-new");
  const notificationsActive = isNavItemActive(pathname, "/dashboard/notifications");
  const { current: themeChoice, Icon: ThemeIcon, cycle: cycleTheme } = useThemeCycle();
  // UX-51: both buttons name the setting in use ("Theme: Dark", with the
  // matching icon); a click still moves to the next one.
  const { toggle: toggleLocale } = useLocaleToggle(locale);
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
          <Tooltip
            label={current.name}
            render={
              <span
                role="img"
                aria-label={current.name}
                className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold"
              />
            }
          >
            {current.name.slice(0, 1).toUpperCase()}
          </Tooltip>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 short:flex-none short:overflow-visible">
        {navItems.map(({ href, key, icon: Icon, color }) => {
          const active = isNavItemActive(pathname, href);
          const label = dict.nav[key];
          return (
            <Tooltip
              key={href}
              label={label}
              disabled={expanded}
              render={
                <Link
                  href={href}
                  aria-label={expanded ? undefined : label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors pointer-coarse:min-h-11",
                    !expanded && "justify-center",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                />
              }
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
            </Tooltip>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* Doubles as the app's version display. The dot stays until the
            user opens What's new for the newest release (see
            src/lib/release-notes/index.ts). The version arrives as a prop so
            the release history JSON stays out of the client bundle. */}
        <Tooltip
          label={`${dict.nav.whatsNew} · v${version}`}
          disabled={expanded}
          render={
            <Link
              href="/dashboard/whats-new"
              aria-label={expanded ? undefined : `${dict.nav.whatsNew} · v${version}`}
              aria-current={whatsNewActive ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors pointer-coarse:h-11",
                !expanded && "justify-center",
                whatsNewActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            />
          }
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
              <span className="ml-auto text-xs tabular-nums">v{version}</span>
            </>
          )}
        </Tooltip>
        <Suspense
          fallback={<NotificationBell items={[]} dict={dict.notifications} expanded={expanded} active={notificationsActive} />}
        >
          <NotificationBellContent
            notifications={notifications}
            dict={dict.notifications}
            expanded={expanded}
            active={notificationsActive}
          />
        </Suspense>
        <FooterButton
          label={dict.language.toggleLabel}
          expanded={expanded}
          onClick={toggleLocale}
          text={format(dict.language.current, { language: locale === "sv" ? dict.language.swedish : dict.language.english })}
        >
          <Languages className="size-4" />
        </FooterButton>
        <FooterButton label={dict.theme.toggleLabel} expanded={expanded} onClick={cycleTheme} text={format(dict.theme.current, { theme: dict.theme[themeChoice] })}>
          <ThemeIcon className="size-4" />
        </FooterButton>
        <FooterButton
          label={dict.nav.logOut}
          expanded={expanded}
          onClick={logOut}
          disabled={loggingOut}
          text={dict.nav.logOut}
        >
          <LogOut className="size-4" />
        </FooterButton>
        <FooterButton
          label={expanded ? dict.nav.collapseSidebar : dict.nav.expandSidebar}
          expanded={expanded}
          onClick={toggle}
          text={dict.nav.collapse}
          alwaysNamed
        >
          {expanded ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </FooterButton>
      </div>
    </aside>
  );
}
