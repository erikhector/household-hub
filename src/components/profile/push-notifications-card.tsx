"use client";

// Subscribe/unsubscribe toggle for Web Push, following
// node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md's
// "Implementing Web Push Notifications" step (per AGENTS.md). Delivery is
// wired into the notification center's two triggers server-side — see
// sendPushToHousehold's doc comment in src/lib/push.ts. Once subscribed,
// the card also shows this browser's quiet hours (GAP-14,
// push-quiet-hours-form.tsx).

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PushQuietHoursForm } from "@/components/profile/push-quiet-hours-form";
import { subscribeToPushAction, unsubscribeFromPushAction } from "@/lib/actions/push";
import { pushAvailability, type PushAvailability } from "@/lib/platform";
import { serviceWorkerUrl } from "@/lib/service-worker-url";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { resolveSubscriptionState, type SubscriptionState } from "@/lib/push-subscription-state";

// Inlined by Next at build time (NEXT_PUBLIC_-prefixed vars are readable
// from the browser bundle). Unset in an environment that hasn't generated
// VAPID keys yet — see .env.example. Same on server and client, so this is
// safe to read directly (no hydration-mismatch concern, unlike the
// browser-only checks below).
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type Support = PushAvailability;

// Read via useSyncExternalStore, not useState+useEffect — see the matching
// comment in install-app-card.tsx for why (SSR/hydration-safe browser reads).
const noSubscription = () => () => {};
function getSupportSnapshot(): Support {
  // iOS Safari's legacy standalone flag (pre-display-mode adoption), for an
  // installed PWA that would otherwise read as a plain browser tab.
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return pushAvailability({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    // iOS Safari has no `Notification` global in a plain tab (only in a
    // Home Screen web app), so reading it bare threw and crashed the profile
    // page there (caught by the WebKit `iphone` e2e project, UX-32). No API
    // means nothing was ever denied: "default" lets the iOS check above
    // answer "ios-install".
    permission: "Notification" in window ? Notification.permission : "default",
  });
}
const getSupportServerSnapshot = (): Support => "unsupported";

// The signed-in user's stored subscriptions, loaded by the profile page. The
// server can't know which one is *this* browser — only the browser's own
// pushManager knows its endpoint — so the card matches on that client-side.
// They're all the user's own rows (the page scopes by userId), so exposing
// the endpoints to this user's browser reveals nothing they don't own.
export type StoredPushSubscription = {
  endpoint: string;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
};

export function PushNotificationsCard({
  subscriptions,
  dict,
}: {
  subscriptions: StoredPushSubscription[];
  dict: Dictionary["profile"]["pushNotifications"];
}) {
  const support = useSyncExternalStore(noSubscription, getSupportSnapshot, getSupportServerSnapshot);
  // What the browser itself reports; reconciled against the server's rows
  // below (SEC-14).
  const [browserState, setSubscriptionState] = useState<SubscriptionState>("checking");
  // True once this card has saved the subscription itself (SEC-14).
  const [confirmedLocally, setConfirmedLocally] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || support !== "available") return;

    navigator.serviceWorker
      .register(serviceWorkerUrl(), { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => {
        setEndpoint(sub?.endpoint ?? null);
        setSubscriptionState(sub ? "subscribed" : "unsubscribed");
      })
      .catch(() => setSubscriptionState("unsubscribed"));
  }, [support]);

  async function handleSubscribe() {
    if (!VAPID_PUBLIC_KEY) return;
    setPending(true);
    setError(false);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await subscribeToPushAction({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
        // Stored so quiet hours are evaluated in this device's local time
        // rather than the server's (see isWithinQuietHours).
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setEndpoint(sub.endpoint);
      setConfirmedLocally(true);
      setSubscriptionState("subscribed");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  async function handleUnsubscribe() {
    setPending(true);
    setError(false);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await unsubscribeFromPushAction(sub.endpoint);
      }
      setEndpoint(null);
      setConfirmedLocally(false);
      setSubscriptionState("unsubscribed");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  // A browser subscription with no server row (dropped by a password reset
  // on another device, SEC-5) shows as unsubscribed, not "Subscribed".
  const subscriptionState = resolveSubscriptionState({
    browserState,
    endpoint,
    storedEndpoints: subscriptions.map((s) => s.endpoint),
    confirmedLocally,
  });

  const status = !VAPID_PUBLIC_KEY
    ? "notConfigured"
    : support !== "available"
      ? support
      : subscriptionState === "checking"
        ? null
        : subscriptionState;

  // Undefined for a moment right after subscribing, until
  // subscribeToPushAction's revalidatePath delivers the refreshed
  // `subscriptions` prop — the picker simply appears once it lands.
  const stored = endpoint ? subscriptions.find((s) => s.endpoint === endpoint) : undefined;

  return (
    <div className="list-bleed flex flex-col gap-2 rounded-md border p-4">
      <div>
        <h3 className="font-heading text-base font-semibold">{dict.title}</h3>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      {status === "notConfigured" && <p className="text-sm text-muted-foreground">{dict.notConfigured}</p>}
      {status === "unsupported" && <p className="text-sm text-muted-foreground">{dict.unsupported}</p>}
      {/* UX-29: on iOS 16.4+ outside the installed app the APIs may already
          exist, but pushes only arrive once Squirrel is on the Home Screen —
          so this says what to do instead of "not supported". */}
      {status === "ios-install" && <p className="text-sm text-muted-foreground">{dict.iosInstallRequired}</p>}
      {status === "denied" && <p className="text-sm text-muted-foreground">{dict.permissionDenied}</p>}
      {status === "subscribed" && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-success">{dict.enabled}</p>
          <Button type="button" variant="outline" size="sm" onClick={handleUnsubscribe} disabled={pending}>
            <BellOff className="size-4" />
            {dict.disableButton}
          </Button>
        </div>
      )}
      {status === "subscribed" && stored && (
        <PushQuietHoursForm
          key={stored.endpoint}
          endpoint={stored.endpoint}
          quietHoursStart={stored.quietHoursStart}
          quietHoursEnd={stored.quietHoursEnd}
          dict={dict.quietHours}
        />
      )}
      {status === "unsubscribed" && (
        <Button type="button" onClick={handleSubscribe} disabled={pending} className="self-start">
          <Bell className="size-4" />
          {dict.enableButton}
        </Button>
      )}
      {/* Guarded on status !== "denied": a subscribe attempt that gets
          denied sets `error` true in the catch below, but by the time this
          re-renders, getSupportSnapshot() above has already picked up the
          now-"denied" Notification.permission and switched `status` to
          "denied" too — without this guard, both the generic message here
          and the specific denied-permission message above would show at
          once. The specific one wins (see docs/archive/UX_AUDIT_IMPLEMENTATION_PLAN.md's
          G4). */}
      {error && status !== "denied" && <p className="text-sm text-destructive">{dict.error}</p>}
    </div>
  );
}
