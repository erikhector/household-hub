import Link from "next/link";
import { requireHousehold } from "@/lib/session";
import { getTimeZone } from "@/lib/get-time-zone";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { loadWrapped } from "@/lib/wrapped/load";
import { wrappedYear } from "@/lib/wrapped/wrapped-season";
import { PageTitle } from "@/components/dashboard/page-title";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";
import { Button } from "@/components/ui/button";
import { WrappedStory } from "@/components/wrapped/wrapped-story";

// Squirrel Wrapped: the household's year in review (REQUIREMENTS.md,
// "Squirrel Wrapped"). The numbers are worked out here, on the server, from
// this household's rows only (src/lib/wrapped/load.ts), and the story player
// gets plain stats and its slice of the dictionary. A household with too
// little to look back on gets a friendly "check back later" instead.
export default async function WrappedPage() {
  const [{ household }, dict, locale, timeZone] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    getTimeZone(),
  ]);
  const now = new Date();
  const result = await loadWrapped(household.id, wrappedYear(now, timeZone), now, timeZone);
  const t = dict.wrapped;

  if (result.state === "thin") {
    return (
      <div className="flex flex-col gap-6">
        <PageTitle>{t.title}</PageTitle>
        <MascotEmptyState
          alt={t.persona.mascotAlt}
          action={<Button render={<Link href="/dashboard" />}>{t.thin.backHome}</Button>}
        >
          <h2 className="text-item-title font-semibold text-balance">{t.thin.heading}</h2>
          <p className="max-w-sm text-sm text-balance text-muted-foreground">{t.thin.body}</p>
        </MascotEmptyState>
      </div>
    );
  }

  return (
    <WrappedStory stats={result.stats} cards={result.cards} householdName={household.name} locale={locale} dict={t} />
  );
}
