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
import { toast } from "sonner";
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
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";

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
          onClick={() =>
            startTransition(async () => {
              const result = await dismissAllNotificationsAction();
              if (result.error) toast.error(result.error);
            })
          }
        >
          {dict.history.markAllRead}
        </Button>
      </div>

      {items.length === 0 ? (
        <MascotEmptyState alt={dict.history.mascotAlt}>
          <p className="text-sm text-muted-foreground">{dict.history.empty}</p>
        </MascotEmptyState>
      ) : (
        <ul className="list-bleed flex flex-col divide-y rounded-lg border">
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
                  <Icon className={cn("size-4 shrink-0", isGoodNews && "text-success")} />
                  <span className="min-w-0 flex-1 line-clamp-2 break-words sm:line-clamp-1 text-sm">{notificationLabel(item, dict)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatTimestamp(item.createdAt, locale)}
                  </span>
                  {isUnread && (
                    <>
                      {/* A role-less span's aria-label is ignored by screen readers, so the
                          dot is decorative and the word itself is read as link text. */}
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                      <span className="sr-only">{dict.history.unread}</span>
                    </>
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
