"use client";

import { useState, useTransition } from "react";
import { Crown, LogOut, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { leaveHouseholdAction, removeMemberAction, transferOwnershipAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Member = {
  id: string;
  userId: string;
  role: string;
  displayName: string;
  email: string;
};

export function MemberList({
  members,
  isOwner,
  currentUserId,
  dict,
}: {
  members: Member[];
  isOwner: boolean;
  currentUserId: string;
  dict: Dictionary["household"];
}) {
  const [isPending, startTransition] = useTransition();
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const result = await removeMemberAction(memberId);
      if (result.error) toast.error(result.error);
    });
  }

  function handleTransfer() {
    if (!transferTarget) return;
    const memberId = transferTarget.id;
    startTransition(async () => {
      const result = await transferOwnershipAction(memberId);
      if (result.error) toast.error(result.error);
      setTransferTarget(null);
    });
  }

  function handleLeave() {
    startTransition(async () => {
      const result = await leaveHouseholdAction();
      if (result.error) {
        toast.error(result.error);
        setLeaveOpen(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{dict.roleExplanation}</p>
      {members.map((member) => {
        const isSelf = member.userId === currentUserId;
        return (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="line-clamp-2 break-words sm:line-clamp-1 font-medium" title={member.displayName}>
                {member.displayName}
              </p>
              <p className="line-clamp-2 break-words sm:line-clamp-1 text-sm text-muted-foreground" title={member.email}>
                {member.email}
              </p>
              {isSelf && member.role === "OWNER" && (
                <p className="text-xs text-muted-foreground">{dict.leave.ownerExplanation}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={member.role === "OWNER" ? "secondary" : "outline"}>
                {member.role === "OWNER" ? dict.owner : dict.contributor}
              </Badge>
              {isOwner && member.role !== "OWNER" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-primary"
                  disabled={isPending}
                  aria-label={format(dict.transfer.ariaLabel, { name: member.displayName })}
                  onClick={() => setTransferTarget(member)}
                >
                  <Crown className="size-3.5" />
                </Button>
              )}
              {isOwner && member.role !== "OWNER" && (
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={isPending}
                      aria-label={format(dict.removeAriaLabel, { name: member.displayName })}
                    >
                      <UserMinus className="size-3.5" />
                    </Button>
                  }
                  title={format(dict.confirmRemoveMember.title, { name: member.displayName })}
                  description={dict.confirmRemoveMember.description}
                  cancelLabel={dict.confirmRemoveMember.cancel}
                  confirmLabel={dict.confirmRemoveMember.confirm}
                  pendingLabel={dict.confirmRemoveMember.confirming}
                  onConfirm={() => handleRemove(member.id)}
                />
              )}
              {isSelf && member.role !== "OWNER" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={isPending}
                  aria-label={dict.leave.ariaLabel}
                  onClick={() => setLeaveOpen(true)}
                >
                  <LogOut className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}

      <Dialog
        open={transferTarget !== null}
        onOpenChange={(next) => {
          if (!next) setTransferTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {transferTarget
                ? format(dict.transfer.confirmTitle, { name: transferTarget.displayName })
                : ""}
            </DialogTitle>
            <DialogDescription>
              {transferTarget
                ? format(dict.transfer.confirmDescription, { name: transferTarget.displayName })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{dict.transfer.cancel}</DialogClose>
            <Button disabled={isPending} onClick={handleTransfer}>
              {isPending ? dict.transfer.transferring : dict.transfer.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.leave.confirmTitle}</DialogTitle>
            <DialogDescription>{dict.leave.confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{dict.leave.cancel}</DialogClose>
            <Button variant="destructive" disabled={isPending} onClick={handleLeave}>
              {isPending ? dict.leave.leaving : dict.leave.confirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
