import { describe, expect, it } from "vitest";
import { resolveSubscriptionState } from "@/lib/push-subscription-state";

const base = { endpoint: "https://fcm.googleapis.com/a", storedEndpoints: [] as string[], confirmedLocally: false };

describe("resolveSubscriptionState", () => {
  it("passes checking and unsubscribed through untouched", () => {
    expect(resolveSubscriptionState({ ...base, browserState: "checking" })).toBe("checking");
    expect(resolveSubscriptionState({ ...base, browserState: "unsubscribed", endpoint: null })).toBe("unsubscribed");
  });

  it("is subscribed when the browser's endpoint has a server row", () => {
    expect(
      resolveSubscriptionState({ ...base, browserState: "subscribed", storedEndpoints: [base.endpoint] }),
    ).toBe("subscribed");
  });

  it("is unsubscribed when the browser holds a subscription the server dropped (SEC-5 reset)", () => {
    expect(resolveSubscriptionState({ ...base, browserState: "subscribed" })).toBe("unsubscribed");
    expect(
      resolveSubscriptionState({ ...base, browserState: "subscribed", storedEndpoints: ["https://other"] }),
    ).toBe("unsubscribed");
  });

  it("trusts a subscription this card just saved, before the refreshed rows arrive", () => {
    expect(resolveSubscriptionState({ ...base, browserState: "subscribed", confirmedLocally: true })).toBe(
      "subscribed",
    );
  });
});
