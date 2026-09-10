"use client";

// Bell icon + dropdown panel for the notification center (see
// REQUIREMENTS.md's "Notification center" section). `getActiveNotifications`
// (src/lib/notifications.ts) resolves the current alert list server-side, in
// `src/app/dashboard/layout.tsx`; this file renders what it's handed and, on
// click, dismisses the clicked alert (see dismissNotificationAction) before
// letting the Link's own navigation proceed — that's the only client-side
// behavior here, no polling or client-side fetch of the list itself.
//
// Two shapes are exported because the bell sits in two different places
// (REQUIREMENTS.md's "Navigation & responsive layout"): `NotificationBell`
// is a standalone dropdown for the desktop sidebar's bottom toggle section
// (same tier as the theme/language toggle buttons there); `NotificationMenuItem`
// nests as a submenu inside the mobile bottom nav's existing "More" dropdown
// (same tier as the theme/language toggle items there) rather than adding a
// 6th primary icon to the bottom bar.

import Link from "next/link";
import { Bell, CalendarDays, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "@/lib/i18n/format";
import { dismissNotificationAction } from "@/lib/actions/notifications";
import type { NotificationItem } from "@/lib/notifications";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

function notificationHref(item: NotificationItem): string {
  if (item.kind === "outOfStock") return `/dashboard/inventory?status=out`;
  return `/dashboard/meal-planning?week=${item.weekStartKey}`;
}

function notificationLabel(item: NotificationItem, dict: Dictionary["notifications"]): string {
  if (item.kind === "outOfStock") return format(dict.outOfStock, { name: item.name });
  return item.name ? format(dict.mealNotLoggedNamed, { name: item.name }) : dict.mealNotLogged;
}

export function NotificationCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute flex items-center justify-center rounded-full bg-destructive font-semibold text-white",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function BellIcon({ count }: { count: number }) {
  return (
    <span className="relative inline-flex">
      <Bell className="size-4" />
      <NotificationCountBadge count={count} className="-top-1.5 -right-1.5 size-4 text-[10px]" />
    </span>
  );
}

function NotificationEntries({
  items,
  dict,
}: {
  items: NotificationItem[];
  dict: Dictionary["notifications"];
}) {
  if (items.length === 0) {
    return <p className="px-1.5 py-2 text-sm text-muted-foreground">{dict.empty}</p>;
  }

  return (
    <>
      {items.map((item) => {
        const Icon = item.kind === "outOfStock" ? Package : CalendarDays;
        return (
          <DropdownMenuItem
            key={item.id}
            onClick={() => dismissNotificationAction(item.id)}
            render={<Link href={notificationHref(item)} />}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{notificationLabel(item, dict)}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

export function NotificationBell({
  items,
  dict,
  expanded,
}: {
  items: NotificationItem[];
  dict: Dictionary["notifications"];
  expanded: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("w-full", expanded ? "justify-start gap-2.5" : "justify-center")}
            title={dict.bellAriaLabel}
          />
        }
      >
        <BellIcon count={items.length} />
        {expanded && dict.title}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <NotificationEntries items={items} dict={dict} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NotificationMenuItem({
  items,
  dict,
}: {
  items: NotificationItem[];
  dict: Dictionary["notifications"];
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BellIcon count={items.length} />
        {dict.title}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <NotificationEntries items={items} dict={dict} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
