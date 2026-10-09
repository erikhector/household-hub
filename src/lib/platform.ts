// UX-29 platform polish: pure browser-platform helpers shared by the PWA
// install and push-notification cards. Everything here takes explicit values
// (never touches `navigator`/`window` itself) so the snapshot closures in
// those cards stay one-liners and every branch is unit-testable in Node —
// there is no WebKit or iPhone in CI to test against.

export type NavigatorIdentity = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/** True for an iPad that reports a desktop Mac UA (iPadOS 13+ by default). */
export function isIPadOSDesktopMode(identity: NavigatorIdentity): boolean {
  return (
    identity.platform === "MacIntel" &&
    identity.maxTouchPoints > 1 &&
    !/iPad|iPhone|iPod/.test(identity.userAgent)
  );
}

/** True for any iPhone/iPod/iPad, including desktop-mode iPadOS. */
export function isAppleMobile(identity: NavigatorIdentity): boolean {
  return /iPad|iPhone|iPod/.test(identity.userAgent) || isIPadOSDesktopMode(identity);
}

export type IOSVersion = { major: number; minor: number };

/**
 * The iOS/iPadOS version, or null when it can't be told (not an Apple-mobile
 * device, or an UA without a version token). Reads the `OS 16_4` token in
 * mobile UAs and falls back to `Version/16.4` for desktop-mode iPadOS, whose
 * UA is otherwise indistinguishable from macOS Safari's.
 */
export function iosVersion(identity: NavigatorIdentity): IOSVersion | null {
  if (!isAppleMobile(identity)) return null;
  const os = identity.userAgent.match(/(?:iPhone OS|CPU OS) (\d+)[_.](\d+)/);
  if (os) return { major: Number(os[1]), minor: Number(os[2]) };
  const version = identity.userAgent.match(/Version\/(\d+)(?:[_.](\d+))?/);
  if (version) return { major: Number(version[1]), minor: Number(version[2] ?? 0) };
  return null;
}

/**
 * Whether this Apple-mobile install could get push by adding Squirrel to
 * the Home Screen: iOS/iPadOS 16.4+, the release that brought Web Push to
 * Home Screen web apps.
 */
export function isIosHomeScreenPushCandidate(identity: NavigatorIdentity): boolean {
  const version = iosVersion(identity);
  return version !== null && (version.major > 16 || (version.major === 16 && version.minor >= 4));
}

export type PushAvailability = "available" | "denied" | "unsupported" | "ios-install";

export type PushEnvironment = NavigatorIdentity & {
  /** `display-mode: standalone` matched (or legacy `navigator.standalone`). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: "default" | "denied" | "granted";
};

/**
 * What the push-notifications card should show. On iOS/iPadOS 16.4+ outside
 * standalone mode the answer is "ios-install" — install first, then push
 * works — even though the Push API objects may already exist in Safari.
 * Everywhere else without the APIs it stays a plain "unsupported".
 */
export function pushAvailability(env: PushEnvironment): PushAvailability {
  if (env.permission === "denied") return "denied";
  if (!env.standalone && isIosHomeScreenPushCandidate(env)) return "ios-install";
  if (env.hasServiceWorker && env.hasPushManager) return "available";
  return "unsupported";
}
