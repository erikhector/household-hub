import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { InviteButton } from "@/components/household/invite-button";
import { Badge } from "@/components/ui/badge";

export default async function HouseholdPage() {
  const { household, userId } = await requireHousehold();

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
          <h1 className="text-2xl font-semibold tracking-tight">Household</h1>
          <p className="text-sm text-muted-foreground">{household.name}</p>
          {otherMembers > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-4" />
              Shared with {otherMembers} other {otherMembers === 1 ? "person" : "people"}
            </p>
          )}
        </div>
        <InviteButton />
      </div>
      <div className="flex flex-col gap-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div>
              <p className="font-medium">{member.user.displayName}</p>
              <p className="text-sm text-muted-foreground">{member.user.email}</p>
            </div>
            <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
              {member.role === "OWNER" ? "Owner" : "Member"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
