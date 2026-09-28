"use client";

import { useTransition } from "react";
import { logoutAction } from "@/lib/actions/auth";

// Only the browser's own pushManager knows this device's subscription (see
// push-notifications-card.tsx's identical reasoning) — null here just means
// "nothing to drop": no service worker, no subscription, or no JS, the same
// as logout's behavior before SEC-5.
async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

// SEC-5: logging out on a device drops that device's push subscription on
// both sides — the server row (via logoutAction, so no more pushes reach
// it) and the browser's own registration (so push-notifications-card.tsx
// doesn't keep showing "Subscribed" for a row the server no longer has,
// e.g. after logging back in on the same browser). Best-effort: if the
// browser-side unsubscribe fails, the server side still runs — the push
// card ends up stale rather than actively broken, no worse than before
// this existed. `pending` lets every entry point (sidebar, bottom-nav,
// LogoutButton) disable itself while the lookup + sign-out are in flight,
// since this is no longer a plain form submit.
export function useLogout() {
  const [pending, startTransition] = useTransition();

  function logOut() {
    startTransition(async () => {
      const subscription = await getCurrentPushSubscription();
      await subscription?.unsubscribe().catch(() => {});
      await logoutAction(subscription?.endpoint);
    });
  }

  return { logOut, pending };
}
