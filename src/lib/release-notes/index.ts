// App-side view of the release history. releases.json is written only by the
// release workflow (.github/workflows/release.yml → scripts/release.ts) when
// a PR is merged, newest first, and bundled into the build, so the list
// always matches the code that's actually deployed. No database table or
// GitHub API call at runtime.
//
// Client-safe (plain data, no "server-only"): the sidebar reads the latest
// version too.

import releasesJson from "@/lib/release-notes/releases.json";
import { compareVersions, type ReleaseEntry } from "@/lib/release-notes/release-calc";
import type { Locale } from "@/lib/i18n/locales";

export type { ReleaseEntry };

export const RELEASES: readonly ReleaseEntry[] = releasesJson as ReleaseEntry[];

export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";

// Stores the newest version the user has opened "What's new" for, so the
// sidebar can show an unread dot until they look at a new release. A
// preference-category cookie (see src/lib/cookie-inventory.ts): it only
// affects that dot.
export const LAST_SEEN_RELEASE_COOKIE = "last_seen_release";
export const LAST_SEEN_RELEASE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function hasUnseenRelease(lastSeen: string | undefined): boolean {
  if (RELEASES.length === 0) return false;
  if (!lastSeen || !/^\d+\.\d+\.\d+$/.test(lastSeen)) return true;
  return compareVersions(CURRENT_VERSION, lastSeen) > 0;
}

// Swedish falls back to English when the PR author didn't write an `sv`
// note, better than showing an empty entry.
export function releaseNoteFor(entry: ReleaseEntry, locale: Locale): string {
  return (locale === "sv" ? entry.notes.sv : null) ?? entry.notes.en;
}
