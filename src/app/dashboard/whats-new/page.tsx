import { cookies } from "next/headers";
import { MarkReleaseSeen } from "@/components/whats-new/mark-release-seen";
import { ReleaseList } from "@/components/whats-new/release-list";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { CURRENT_VERSION, hasUnseenRelease, LAST_SEEN_RELEASE_COOKIE } from "@/lib/release-notes";
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

  return (
    <div className="flex flex-col gap-6">
      <MarkReleaseSeen version={CURRENT_VERSION} alreadySeen={alreadySeen} />
      <div>
        <PageTitle>{t.title}</PageTitle>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{format(t.currentVersion, { version: CURRENT_VERSION })}</p>
      </div>
      <ReleaseList dict={t} locale={locale} />
    </div>
  );
}
