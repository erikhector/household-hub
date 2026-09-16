"use client";

// Subscribe/unsubscribe toggle for Web Push, following
// node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md's
// "Implementing Web Push Notifications" step (per AGENTS.md). Delivery is
// wired into the notification center's two triggers server-side — see
// sendPushToHousehold's doc comment in src/lib/push.ts.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { subscribeToPushAction, unsubscribeFromPushAction } from "@/lib/actions/push";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

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

type Support = "unsupported" | "denied" | "available";

// Read via useSyncExternalStore, not useState+useEffect — see the matching
// comment in install-app-card.tsx for why (SSR/hydration-safe browser reads).
const noSubscription = () => () => {};
function getSupportSnapshot(): Support {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "available";
}
const getSupportServerSnapshot = (): Support => "unsupported";

type SubscriptionState = "checking" | "subscribed" | "unsubscribed";

export function PushNotificationsCard({ dict }: { dict: Dictionary["profile"]["pushNotifications"] }) {
  const support = useSyncExternalStore(noSubscription, getSupportSnapshot, getSupportServerSnapshot);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState>("checking");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || support !== "available") return;

    navigator.serviceWorker
      .register(new URL("../../lib/service-worker.js", import.meta.url), { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setSubscriptionState(sub ? "subscribed" : "unsubscribed"))
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
      });
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
      setSubscriptionState("unsubscribed");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  const status = !VAPID_PUBLIC_KEY
    ? "notConfigured"
    : support !== "available"
      ? support
      : subscriptionState === "checking"
        ? null
        : subscriptionState;

  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      {status === "notConfigured" && <p className="text-sm text-muted-foreground">{dict.notConfigured}</p>}
      {status === "unsupported" && <p className="text-sm text-muted-foreground">{dict.unsupported}</p>}
      {status === "denied" && <p className="text-sm text-muted-foreground">{dict.permissionDenied}</p>}
      {status === "subscribed" && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-chart-5">{dict.enabled}</p>
          <Button type="button" variant="outline" size="sm" onClick={handleUnsubscribe} disabled={pending}>
            <BellOff className="size-4" />
            {dict.disableButton}
          </Button>
        </div>
      )}
      {status === "unsubscribed" && (
        <Button type="button" onClick={handleSubscribe} disabled={pending} className="self-start">
          <Bell className="size-4" />
          {dict.enableButton}
        </Button>
      )}
      {error && <p className="text-sm text-destructive">{dict.error}</p>}
    </div>
  );
}
