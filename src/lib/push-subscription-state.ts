// SEC-14: what the Push-notifications card should show for this browser.
//
// `pushManager.getSubscription()` only says the *browser* still holds a
// subscription. A password reset/change (SEC-5) deletes every
// `PushSubscription` row for the user, but every other signed-in device keeps
// its browser-side subscription, which now receives nothing. So the browser's
// answer alone is not enough: the endpoint must also have a row on the
// server (the profile page's `subscriptions` prop), or have been saved by this
// very card a moment ago — `confirmedLocally` covers the gap before the
// action's revalidatePath delivers the refreshed prop.
//
// When there is no row we show "unsubscribed" rather than silently recreating
// it: the reset deliberately revoked push, so restoring it is the user's call
// (one tap on Enable, which reuses the browser's existing subscription and
// upserts its row via subscribeToPushAction).

export type SubscriptionState = "checking" | "subscribed" | "unsubscribed";

export function resolveSubscriptionState({
  browserState,
  endpoint,
  storedEndpoints,
  confirmedLocally,
}: {
  browserState: SubscriptionState;
  endpoint: string | null;
  storedEndpoints: readonly string[];
  confirmedLocally: boolean;
}): SubscriptionState {
  if (browserState !== "subscribed") return browserState;
  if (confirmedLocally) return "subscribed";
  return endpoint !== null && storedEndpoints.includes(endpoint) ? "subscribed" : "unsubscribed";
}
