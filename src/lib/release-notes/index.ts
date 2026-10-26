// App-side view of the release history. releases.json is written only by the
// release workflow (.github/workflows/release.yml → scripts/release.ts) when
// a PR is merged, newest first, and bundled into the build, so the list
// always matches the code that's actually deployed. No database table or
// GitHub API call at runtime.
//
// Server-side only in practice: the full history is ~135 KB, so no Client
// Component may import this module. The dashboard layout reads
// CURRENT_VERSION and passes it down as a prop; the cookie constants a client
// needs live in cookie.ts. The guard test in client-bundle.test.ts checks it.

import releasesJson from "@/lib/release-notes/releases.json";
import { compareVersions, type ReleaseEntry } from "@/lib/release-notes/release-calc";
import type { Locale } from "@/lib/i18n/locales";

export type { ReleaseEntry };

export const RELEASES: readonly ReleaseEntry[] = releasesJson as ReleaseEntry[];

export const CURRENT_VERSION = RELEASES[0]?.version ?? "0.0.0";

export { LAST_SEEN_RELEASE_COOKIE, LAST_SEEN_RELEASE_COOKIE_MAX_AGE } from "@/lib/release-notes/cookie";

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
