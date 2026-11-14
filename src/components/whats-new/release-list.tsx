import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { RELEASES, releaseNoteFor } from "@/lib/release-notes";

// UX-190: how many releases the page renders before "Show older updates".
// With every release as a card the page was ~138 000 px tall on a phone,
// and someone arriving from the unread dot wants the last few changes.
const RECENT_RELEASES = 10;

const releaseAnchor = (version: string) => `release-${version}`;

// The release history as a list, newest first. Shared by the in-app page
// (/dashboard/whats-new) and the public one (/whats-new), so a logged-out
// visitor reads exactly what members see.
//
// Only the newest RECENT_RELEASES are rendered unless `showAll` (the page's
// `?all=1`). The older ones sit behind a link rather than a <details> or a
// client toggle, so the server doesn't send (and the phone doesn't hold)
// hundreds of cards nobody opened, and the link works before hydration.
// It points at the first older release, so the reader carries on from
// where they were instead of starting again at the top.
export function ReleaseList({
  dict,
  locale,
  showAll,
  path,
}: {
  dict: Dictionary["whatsNew"];
  locale: Locale;
  showAll: boolean;
  path: string;
}) {
  // Dates are stored as plain YYYY-MM-DD (UTC merge day), so format in UTC
  // to avoid shifting to the previous day west of Greenwich.
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

  if (RELEASES.length === 0) {
    return <p className="text-sm text-muted-foreground">{dict.empty}</p>;
  }
  const releases = showAll ? RELEASES : RELEASES.slice(0, RECENT_RELEASES);
  const firstOlder = showAll ? undefined : RELEASES[RECENT_RELEASES];
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <ol className="list-bleed flex flex-col gap-3">
        {releases.map((release, index) => (
          <li
            key={release.version}
            id={releaseAnchor(release.version)}
            className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-md border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-base font-semibold tabular-nums">
                {format(dict.version, { version: release.version })}
              </h2>
              {index === 0 && <Badge>{dict.latest}</Badge>}
              {release.breaking && <Badge variant="outline">{dict.breaking}</Badge>}
              <time dateTime={release.date} className="ml-auto text-xs text-muted-foreground">
                {dateFormat.format(new Date(`${release.date}T00:00:00Z`))}
              </time>
            </div>
            {/* break-words: a note is free text from a PR description and can
                carry an unbreakable run (a URL, a long Swedish compound) that
                would otherwise push `main` wider than a phone (BUG-4). */}
            <p className="text-sm break-words whitespace-pre-line">{releaseNoteFor(release, locale)}</p>
          </li>
        ))}
      </ol>
      {firstOlder && (
        // A plain link styled as a button: it navigates (to ?all=1), so it
        // keeps the link role. buttonVariants gives it the 44 px phone
        // height (M3).
        <Link
          href={`${path}?all=1#${releaseAnchor(firstOlder.version)}`}
          className={buttonVariants({ variant: "outline", className: "self-start" })}
        >
          {dict.showOlder}
        </Link>
      )}
    </div>
  );
}
