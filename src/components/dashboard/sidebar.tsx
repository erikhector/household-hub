"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { navItems, isNavItemActive, SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { logoutAction } from "@/lib/actions/auth";

const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type HouseholdOption = { id: string; name: string; role: string };

export function Sidebar({
  defaultExpanded,
  current,
  households,
}: {
  defaultExpanded: boolean;
  current: HouseholdOption;
  households: HouseholdOption[];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const pathname = usePathname();

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
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
          <HouseholdSwitcher current={current} households={households} />
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
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isNavItemActive(pathname, href);
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
              <Icon className="size-4 shrink-0" />
              {expanded && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t p-2">
        <form action={logoutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
            title={expanded ? undefined : "Log out"}
          >
            <LogOut className="size-4" />
            {expanded && "Log out"}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggle}
          className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          {expanded && "Collapse"}
        </Button>
      </div>
    </aside>
  );
}
