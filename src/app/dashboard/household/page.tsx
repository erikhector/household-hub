import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { InviteButton } from "@/components/household/invite-button";
import { Badge } from "@/components/ui/badge";

export default async function HouseholdPage() {
  const { household } = await requireHousehold();

  const members = await prisma.householdMember.findMany({
    where: { householdId: household.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Household</h1>
          <p className="text-sm text-muted-foreground">{household.name}</p>
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
