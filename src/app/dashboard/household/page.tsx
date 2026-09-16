import { Suspense, cache } from "react";
import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, type Dictionary } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { InviteButton } from "@/components/household/invite-button";
import { MemberList } from "@/components/household/member-list";
import { DeleteHouseholdDialog } from "@/components/household/delete-household-dialog";

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

export default async function HouseholdPage() {
  const [{ household, userId, role }, dict] = await Promise.all([
    requireHousehold(),
    getDictionary(),
  ]);
  const isOwner = role === "OWNER";

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
