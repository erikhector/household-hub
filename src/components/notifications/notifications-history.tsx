"use client";

// The notification center's full list (see
// src/app/dashboard/notifications/page.tsx) — every notification ever
// recorded for the household, not just the still-active ones the bell
// dropdown shows (src/lib/notifications.ts's getNotificationHistory vs.
// getActiveNotifications). Reuses the bell's own href/label/icon mapping
// (src/components/notifications/notification-bell.tsx) so a given
// notification reads identically wherever it's shown.
//
// Clicking a still-unread row dismisses it (same as the bell) before letting
// the Link's navigation proceed; an already-read row is just a link — nothing
// to mark. "Mark all as read" clears every unread row in one action without
// navigating anywhere.

import { useTransition } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  notificationHref,
  notificationLabel,
  notificationIcon,
  GOOD_NEWS_KINDS,
} from "@/components/notifications/notification-bell";
import { dismissNotificationAction, dismissAllNotificationsAction } from "@/lib/actions/notifications";
import type { NotificationHistoryItem } from "@/lib/notifications";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

function formatTimestamp(date: Date, locale: Locale): string {
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function NotificationsHistory({
  items,
  dict,
  locale,
}: {
  items: NotificationHistoryItem[];
  dict: Dictionary["notifications"];
  locale: Locale;
}) {
  const unreadCount = items.filter((item) => item.dismissedAt === null).length;
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || isPending}
          onClick={() => startTransition(() => dismissAllNotificationsAction())}
        >
          {dict.history.markAllRead}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{dict.history.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {items.map((item) => {
            const Icon = notificationIcon(item.kind);
            const isGoodNews = GOOD_NEWS_KINDS.has(item.kind);
            const isUnread = item.dismissedAt === null;
            return (
              <li key={item.id}>
                <Link
                  href={notificationHref(item)}
                  onClick={() => {
                    if (isUnread) void dismissNotificationAction(item.id);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
                    isUnread && "bg-primary/5",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", isGoodNews && "text-chart-5")} />
                  <span className="min-w-0 flex-1 truncate text-sm">{notificationLabel(item, dict)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTimestamp(item.createdAt, locale)}
                  </span>
                  {isUnread && (
                    <span
                      aria-label={dict.history.unread}
                      title={dict.history.unread}
                      className="size-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
