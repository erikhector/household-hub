"use client";

import { useTransition } from "react";
import { UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { removeMemberAction } from "@/lib/actions/household";

type Member = {
  id: string;
  role: string;
  displayName: string;
  email: string;
};

export function MemberList({
  members,
  isOwner,
}: {
  members: Member[];
  isOwner: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const result = await removeMemberAction(memberId);
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {members.map((member) => (
        <div
          key={member.id}
          className="flex items-center justify-between rounded-md border px-3 py-2"
        >
          <div>
            <p className="font-medium">{member.displayName}</p>
            <p className="text-sm text-muted-foreground">{member.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={member.role === "OWNER" ? "default" : "secondary"}>
              {member.role === "OWNER" ? "Owner" : "Contributor"}
            </Badge>
            {isOwner && member.role !== "OWNER" && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                disabled={isPending}
                aria-label={`Remove ${member.displayName}`}
                onClick={() => handleRemove(member.id)}
              >
                <UserMinus className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
