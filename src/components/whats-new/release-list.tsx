import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { RELEASES, releaseNoteFor } from "@/lib/release-notes";

// The release history as a list, newest first. Shared by the in-app page
// (/dashboard/whats-new) and the public one (/whats-new), so a logged-out
// visitor reads exactly what members see.
export function ReleaseList({ dict, locale }: { dict: Dictionary["whatsNew"]; locale: Locale }) {
  // Dates are stored as plain YYYY-MM-DD (UTC merge day), so format in UTC
  // to avoid shifting to the previous day west of Greenwich.
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

  if (RELEASES.length === 0) {
    return <p className="text-sm text-muted-foreground">{dict.empty}</p>;
  }
  return (
    <ol className="list-bleed flex max-w-2xl flex-col gap-3">
      {RELEASES.map((release, index) => (
        <li key={release.version} className="flex min-w-0 flex-col gap-2 rounded-md border p-4">
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
  );
}
