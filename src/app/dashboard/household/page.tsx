import { Suspense, cache } from "react";
import { Users } from "lucide-react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { InviteButton } from "@/components/household/invite-button";
import { MemberList } from "@/components/household/member-list";
import { DeleteHouseholdDialog } from "@/components/household/delete-household-dialog";
import { AutoAddSetting } from "@/components/household/auto-add-setting";
import { HouseholdNotes } from "@/components/household/household-notes";
import { CalendarFeedSetting } from "@/components/household/calendar-feed-setting";
import { CurrencySetting } from "@/components/household/currency-setting";
import { calendarFeedPath } from "@/lib/calendar-feed";

// GAP-3. APP_URL first, request headers only as the local-dev fallback: the
// same order as absoluteAppUrl in src/lib/actions/household.ts (see its doc
// comment). A spoofed Host header can only mislead the person sending it
// here, but the link gets pasted into calendar apps and passed around, so
// it should carry the deployment's real origin whenever one is configured.
async function calendarFeedUrl(path: string): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
}

// Wrapped in `cache()` so the "shared with" note and the member list below
// (both Suspense-isolated, see HouseholdPage) share one query instead of one
// each, the same convention as getInventoryData in the inventory page.
const getHouseholdMembers = cache(async (householdId: string) => {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    displayName: m.user.displayName,
    email: m.user.email,
  }));
});

async function SharedWithNote({
  householdId,
  userId,
  dict,
}: {
  householdId: string;
  userId: string;
  dict: Dictionary["household"];
}) {
  const members = await getHouseholdMembers(householdId);
  const otherMembers = members.filter((m) => m.userId !== userId).length;
  if (otherMembers === 0) return null;
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Users className="size-4 shrink-0" />
      {format(plural(otherMembers, dict.sharedWith), { count: otherMembers })}
    </p>
  );
}

function MemberListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2 rounded-lg border p-4" role="status" aria-label="Loading">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 rounded-md bg-muted/40" />
      ))}
    </div>
  );
}

async function HouseholdMemberList({
  householdId,
  userId,
  isOwner,
  dict,
}: {
  householdId: string;
  userId: string;
  isOwner: boolean;
  dict: Dictionary["household"];
}) {
  const members = await getHouseholdMembers(householdId);
  return <MemberList isOwner={isOwner} currentUserId={userId} dict={dict} members={members} />;
}

// GAP-16. Newest first — the board is for what's current, so the latest note
// belongs at the top. The author's name is resolved through the (nullable)
// authorMember relation rather than getHouseholdMembers: a note whose author
// has left has authorMemberId null (onDelete: SetNull) and renders as
// "former member", which is exactly what a join that finds nothing gives us.
async function HouseholdNotesSection({
  householdId,
  locale,
  dict,
}: {
  householdId: string;
  locale: Locale;
  dict: Dictionary["household"]["notes"];
}) {
  const notes = await prisma.householdNote.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorMember: { select: { user: { select: { displayName: true } } } },
    },
  });
  return (
    <HouseholdNotes
      locale={locale}
      dict={dict}
      notes={notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        authorName: n.authorMember?.user.displayName ?? null,
      }))}
    />
  );
}

export default async function HouseholdPage() {
  const [{ household, userId, role }, dict, locale] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
  ]);
  const isOwner = role === "OWNER";
  const feedUrl = household.calendarFeedToken
    ? await calendarFeedUrl(calendarFeedPath(household.calendarFeedToken, locale))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.household.title}</h1>
          <p className="truncate text-sm text-muted-foreground" title={household.name}>
            {household.name}
          </p>
          <Suspense fallback={null}>
            <SharedWithNote householdId={household.id} userId={userId} dict={dict.household} />
          </Suspense>
        </div>
        <div className="shrink-0">
          <InviteButton dict={dict.household.invite} />
        </div>
      </div>
      <Suspense fallback={<MemberListSkeleton />}>
        <HouseholdMemberList householdId={household.id} userId={userId} isOwner={isOwner} dict={dict.household} />
      </Suspense>
      {/* Its own Suspense boundary so a slow notes query never holds up
          the member list above (same reasoning as HouseholdMemberList). */}
      <Suspense fallback={<MemberListSkeleton />}>
        <HouseholdNotesSection householdId={household.id} locale={locale} dict={dict.household.notes} />
      </Suspense>
      {/* Not owner-gated (see setAutoAddLowStockToListAction): day-to-day
          shopping behaviour every member already fully operates. */}
      <AutoAddSetting enabled={household.autoAddLowStockToList} dict={dict.household.shoppingSettings} />
      {/* Owner-gated inside (see setHouseholdCurrencyAction); contributors
          see the current value read-only. */}
      <CurrencySetting
        currencyCode={household.currencyCode}
        isOwner={isOwner}
        locale={locale}
        dict={dict.household.currency}
      />
      <CalendarFeedSetting
        feedUrl={feedUrl}
        isOwner={isOwner}
        dict={dict.household.calendarFeed}
      />
      {isOwner && (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div>
            <h2 className="font-heading text-base font-semibold">{dict.household.dangerZoneTitle}</h2>
            <p className="text-sm text-muted-foreground">{dict.household.dangerZoneDescription}</p>
          </div>
          <div>
            <DeleteHouseholdDialog householdName={household.name} dict={dict.household.delete} />
          </div>
        </div>
      )}
    </div>
  );
}
