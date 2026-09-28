"use client";

import { logoutAction } from "@/lib/actions/auth";

// Only the browser's own pushManager knows this device's subscription
// endpoint (see push-notifications-card.tsx's identical reasoning) —
// undefined here just means "nothing to drop", the same behavior logout
// always had before SEC-5 (no service worker, no subscription, or no JS).
async function getCurrentPushEndpoint(): Promise<string | undefined> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return undefined;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint;
  } catch {
    return undefined;
  }
}

// SEC-5: logging out on a device also drops that device's push subscription,
// so someone who briefly had the account (a shared computer, a borrowed
// phone) stops receiving household pushes here rather than only once their
// session eventually expires.
export async function logOut(): Promise<void> {
  const endpoint = await getCurrentPushEndpoint();
  await logoutAction(endpoint);
}
