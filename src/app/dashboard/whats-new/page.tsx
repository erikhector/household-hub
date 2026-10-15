import { cookies } from "next/headers";
import { Badge } from "@/components/ui/badge";
import { MarkReleaseSeen } from "@/components/whats-new/mark-release-seen";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import {
  CURRENT_VERSION,
  hasUnseenRelease,
  LAST_SEEN_RELEASE_COOKIE,
  RELEASES,
  releaseNoteFor,
} from "@/lib/release-notes";
import { PageTitle } from "@/components/dashboard/page-title";

// Release history, one entry per released PR, written by the release
// workflow into src/lib/release-notes/releases.json (see REQUIREMENTS.md's
// "Releases & What's new" section).
export default async function WhatsNewPage() {
  const [, dict, locale, cookieStore] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    cookies(),
  ]);
  const t = dict.whatsNew;
  const alreadySeen = !hasUnseenRelease(cookieStore.get(LAST_SEEN_RELEASE_COOKIE)?.value);
  // Dates are stored as plain YYYY-MM-DD (UTC merge day), so format in UTC
  // to avoid shifting to the previous day west of Greenwich.
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <MarkReleaseSeen version={CURRENT_VERSION} alreadySeen={alreadySeen} />
      <div>
        <PageTitle>{t.title}</PageTitle>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{format(t.currentVersion, { version: CURRENT_VERSION })}</p>
      </div>
      {RELEASES.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ol className="flex max-w-2xl flex-col gap-3">
          {RELEASES.map((release, index) => (
            <li key={release.version} className="flex flex-col gap-2 rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-base font-semibold tabular-nums">
                  {format(t.version, { version: release.version })}
                </h2>
                {index === 0 && <Badge>{t.latest}</Badge>}
                {release.breaking && <Badge variant="outline">{t.breaking}</Badge>}
                <time dateTime={release.date} className="ml-auto text-xs text-muted-foreground">
                  {dateFormat.format(new Date(`${release.date}T00:00:00Z`))}
                </time>
              </div>
              <p className="text-sm whitespace-pre-line">{releaseNoteFor(release, locale)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
