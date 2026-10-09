import { describe, expect, test } from "vitest";
import {
  isAppleMobile,
  isIPadOSDesktopMode,
  isIosHomeScreenPushCandidate,
  iosVersion,
  pushAvailability,
  type NavigatorIdentity,
} from "./platform";

// Real-world UA strings (trimmed to the tokens that matter).
const IPHONE_17: NavigatorIdentity = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const IPHONE_16_3: NavigatorIdentity = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};
const IPAD_MOBILE_UA: NavigatorIdentity = {
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
  platform: "iPad",
  maxTouchPoints: 5,
};
const IPAD_DESKTOP_UA: NavigatorIdentity = {
  // What an iPad reports with "Request Desktop Website" (the default since
  // iPadOS 13): a Mac UA with touch.
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17_0 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
};
const MAC_DESKTOP: NavigatorIdentity = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 0,
};
const ANDROID_CHROME: NavigatorIdentity = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv8l",
  maxTouchPoints: 5,
};

describe("isIPadOSDesktopMode", () => {
  test("a touch Mac UA is an iPad, a real Mac is not", () => {
    expect(isIPadOSDesktopMode(IPAD_DESKTOP_UA)).toBe(true);
    expect(isIPadOSDesktopMode(MAC_DESKTOP)).toBe(false);
    expect(isIPadOSDesktopMode(ANDROID_CHROME)).toBe(false);
  });
});

describe("isAppleMobile", () => {
  test("covers iPhones, iPads and desktop-mode iPadOS, nothing else", () => {
    expect(isAppleMobile(IPHONE_17)).toBe(true);
    expect(isAppleMobile(IPAD_MOBILE_UA)).toBe(true);
    expect(isAppleMobile(IPAD_DESKTOP_UA)).toBe(true);
    expect(isAppleMobile(MAC_DESKTOP)).toBe(false);
    expect(isAppleMobile(ANDROID_CHROME)).toBe(false);
  });
});

describe("iosVersion", () => {
  test("parses the OS token, the Version fallback, and bails off-Apple", () => {
    expect(iosVersion(IPHONE_17)).toEqual({ major: 17, minor: 2 });
    expect(iosVersion(IPAD_MOBILE_UA)).toEqual({ major: 16, minor: 4 });
    // Desktop-mode iPadOS has no OS token; Version/ is all there is.
    expect(iosVersion(IPAD_DESKTOP_UA)).toEqual({ major: 17, minor: 0 });
    expect(iosVersion(MAC_DESKTOP)).toBeNull();
    expect(iosVersion(ANDROID_CHROME)).toBeNull();
  });
});

describe("isIosHomeScreenPushCandidate", () => {
  test("16.4+ qualifies, older iOS and non-Apple do not", () => {
    expect(isIosHomeScreenPushCandidate(IPHONE_17)).toBe(true);
    expect(isIosHomeScreenPushCandidate(IPAD_MOBILE_UA)).toBe(true);
    expect(isIosHomeScreenPushCandidate(IPHONE_16_3)).toBe(false);
    expect(isIosHomeScreenPushCandidate(ANDROID_CHROME)).toBe(false);
  });
});

describe("pushAvailability", () => {
  const capable = { hasServiceWorker: true, hasPushManager: true, permission: "default" as const };
  const incapable = { hasServiceWorker: false, hasPushManager: false, permission: "default" as const };

  test("denied permission wins over everything", () => {
    expect(pushAvailability({ ...IPHONE_17, ...capable, standalone: false, permission: "denied" })).toBe(
      "denied",
    );
  });

  test("iOS 16.4+ in Safari says install first, even with the APIs present", () => {
    expect(pushAvailability({ ...IPHONE_17, ...capable, standalone: false })).toBe("ios-install");
    expect(pushAvailability({ ...IPHONE_17, ...incapable, standalone: false })).toBe("ios-install");
  });

  test("installed iOS and capable Android/desktop are available", () => {
    expect(pushAvailability({ ...IPHONE_17, ...capable, standalone: true })).toBe("available");
    expect(pushAvailability({ ...ANDROID_CHROME, ...capable, standalone: false })).toBe("available");
  });

  test("old iOS and API-less browsers stay unsupported", () => {
    expect(pushAvailability({ ...IPHONE_16_3, ...incapable, standalone: false })).toBe("unsupported");
    expect(pushAvailability({ ...ANDROID_CHROME, ...incapable, standalone: false })).toBe("unsupported");
  });
});
