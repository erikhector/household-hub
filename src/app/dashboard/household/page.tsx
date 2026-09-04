import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { InviteButton } from "@/components/household/invite-button";
import { MemberList } from "@/components/household/member-list";
import { DeleteHouseholdDialog } from "@/components/household/delete-household-dialog";

export default async function HouseholdPage() {
  const [{ household, userId, role }, dict] = await Promise.all([
    requireHousehold(),
    getDictionary(),
  ]);
  const isOwner = role === "OWNER";

  const members = await prisma.householdMember.findMany({
    where: { householdId: household.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  const otherMembers = members.filter((m) => m.userId !== userId).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.household.title}</h1>
          <p className="text-sm text-muted-foreground">{household.name}</p>
          {otherMembers > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-4" />
              {format(plural(otherMembers, dict.household.sharedWith), { count: otherMembers })}
            </p>
          )}
        </div>
        <InviteButton dict={dict.household.invite} />
      </div>
      <MemberList
        isOwner={isOwner}
        currentUserId={userId}
        dict={dict.household}
        members={members.map((m) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          displayName: m.user.displayName,
          email: m.user.email,
        }))}
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
