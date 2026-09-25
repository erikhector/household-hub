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

import { createElement, useTransition } from "react";
import Link from "next/link";
import { Bell, CalendarClock, CalendarDays, CheckCircle2, Package, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "@/lib/i18n/format";
import { dismissNotificationAction, dismissAllNotificationsAction } from "@/lib/actions/notifications";
import type { NotificationItem } from "@/lib/notifications";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Exported for reuse by the notification center's history list (see
// src/components/notifications/notifications-history.tsx), which renders
// the same rows this dropdown does, plus dismissed ones.
export function notificationHref(item: NotificationItem): string {
  if (item.kind === "outOfStock") return `/dashboard/inventory?status=out`;
  if (item.kind === "expiringSoon") return `/dashboard/inventory`;
  if (item.kind === "listCleared") return `/dashboard/shopping-list/${item.shoppingListId}`;
  return `/dashboard/meal-planning?week=${item.weekStartKey}`;
}

export function notificationLabel(item: NotificationItem, dict: Dictionary["notifications"]): string {
  if (item.kind === "outOfStock") return format(dict.outOfStock, { name: item.name });
  if (item.kind === "expiringSoon") {
    // AUTO-7: softer "probably" copy for a shelf-life estimate rather than
    // a date the household actually entered.
    return format(item.estimated ? dict.expiringSoonEstimated : dict.expiringSoon, { name: item.name });
  }
  if (item.kind === "listCleared") return format(dict.listCleared, { name: item.name });
  return item.name ? format(dict.mealNotLoggedNamed, { name: item.name }) : dict.mealNotLogged;
}

export function notificationIcon(kind: NotificationItem["kind"]) {
  if (kind === "outOfStock") return Package;
  if (kind === "expiringSoon") return CalendarClock;
  if (kind === "listCleared") return CheckCircle2;
  return CalendarDays;
}

// Good-news kinds (see docs/archive/JOY_GAP_BACKLOG.md item 4) get their own icon and a
// calm green accent, distinct from the warning kinds' default (inherited)
// color — a different row treatment, not just a recolor of the same one.
export const GOOD_NEWS_KINDS = new Set<NotificationItem["kind"]>(["listCleared"]);

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

// One notification row: the label/icon is its own menu item (clicking it
// still dismisses-then-navigates, same as before), plus a separate
// icon-only dismiss item alongside it so a notification can be cleared
// without leaving the page (see this file's own header comment — previously
// dismissing and navigating away were the same action, with no way to do
// just the former). `closeOnClick={false}` on the dismiss item keeps the
// dropdown open so several notifications can be cleared in one sitting.
function NotificationRow({ item, dict }: { item: NotificationItem; dict: Dictionary["notifications"] }) {
  const isGoodNews = GOOD_NEWS_KINDS.has(item.kind);
  const [isDismissing, startDismissing] = useTransition();

  return (
    <div className="flex items-stretch gap-1">
      <DropdownMenuItem
        onClick={() => dismissNotificationAction(item.id)}
        render={<Link href={notificationHref(item)} />}
        className="min-w-0 flex-1"
      >
        {/* createElement rather than JSX (`<Icon />`) — notificationIcon()
            just picks among a fixed set of already-existing icon
            components, but this file's other components call hooks, and
            eslint's react-hooks/static-components check can't tell a picked
            existing component apart from a freshly defined one when it's
            assigned to a capitalized variable and used as a JSX tag; this
            sidesteps that false positive without changing behavior. */}
        {createElement(notificationIcon(item.kind), { className: cn("size-4 shrink-0", isGoodNews && "text-chart-5") })}
        <span className="truncate">{notificationLabel(item, dict)}</span>
      </DropdownMenuItem>
      <DropdownMenuItem
        closeOnClick={false}
        disabled={isDismissing}
        onClick={() => startDismissing(async () => dismissNotificationAction(item.id))}
        aria-label={dict.dismiss}
        title={dict.dismiss}
        className="shrink-0 justify-center px-1.5 text-muted-foreground"
      >
        <X className="size-3.5" />
      </DropdownMenuItem>
    </div>
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
      {items.map((item) => (
        <NotificationRow key={item.id} item={item} dict={dict} />
      ))}
    </>
  );
}

// Bulk-dismiss for the dropdown itself (the notification center's history
// page already has this via NotificationsHistory's "mark all read" button —
// this is the same action, reachable from the bell without a page
// navigation). Hidden entirely when there's nothing to clear, same
// threshold as the history page's disabled state.
function DismissAllItem({ items, dict }: { items: NotificationItem[]; dict: Dictionary["notifications"] }) {
  const [isPending, startTransition] = useTransition();
  if (items.length === 0) return null;

  return (
    <DropdownMenuItem
      closeOnClick={false}
      disabled={isPending}
      onClick={() => startTransition(async () => dismissAllNotificationsAction())}
      className="justify-center text-center text-muted-foreground"
    >
      {dict.dismissAll}
    </DropdownMenuItem>
  );
}

// Footer link into the full history page (see
// src/app/dashboard/notifications/page.tsx) — always shown, even with the
// list empty, since "view all" also means past/dismissed alerts this panel
// never shows.
function ViewAllLink({ dict }: { dict: Dictionary["notifications"] }) {
  return (
    <DropdownMenuItem render={<Link href="/dashboard/notifications" />} className="justify-center text-center">
      {dict.viewAll}
    </DropdownMenuItem>
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
        <DropdownMenuSeparator />
        <DismissAllItem items={items} dict={dict} />
        <ViewAllLink dict={dict} />
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
        <DropdownMenuSeparator />
        <DismissAllItem items={items} dict={dict} />
        <ViewAllLink dict={dict} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
