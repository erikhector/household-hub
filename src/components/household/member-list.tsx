"use client";

import { useState, useTransition } from "react";
import { Crown, Ellipsis, LogOut, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createDialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { leaveHouseholdAction, removeMemberAction, transferOwnershipAction } from "@/lib/actions/household";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type Member = {
  id: string;
  userId: string;
  role: string;
  displayName: string;
  email: string;
};

// An owner's two actions on another member, behind one "Member actions" menu
// (UX-145). They used to be two 44 px icons side by side, which squeezed the
// name at 320 px and put Remove (destructive) right next to Transfer, which
// hands the household over (DESIGN.md M2). The menu is one small target, and
// Remove still asks first: its dialog sits outside the menu (a menu's popup
// unmounts as it closes), opened through a handle.
function MemberActions({
  member,
  dict,
  disabled,
  onTransfer,
  onRemove,
}: {
  member: Member;
  dict: Dictionary["household"];
  disabled: boolean;
  onTransfer: () => void;
  onRemove: () => void;
}) {
  const [removeHandle] = useState(() => createDialogHandle());
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={disabled}
              aria-label={format(dict.memberActions.ariaLabel, { name: member.displayName })}
            >
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onTransfer}>
            <Crown />
            {dict.memberActions.transfer}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => removeHandle.open(null)}>
            <UserMinus />
            {dict.memberActions.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        handle={removeHandle}
        title={format(dict.confirmRemoveMember.title, { name: member.displayName })}
        description={dict.confirmRemoveMember.description}
        cancelLabel={dict.confirmRemoveMember.cancel}
        confirmLabel={dict.confirmRemoveMember.confirm}
        pendingLabel={dict.confirmRemoveMember.confirming}
        onConfirm={onRemove}
      />
    </>
  );
}

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
            // On a phone the badge and actions wrap onto a second line rather
            // than squeezing the name into a sliver beside them (UX-145); from
            // `sm` up everything stays on one line.
            className="list-bleed flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border px-3 py-2 sm:flex-nowrap"
          >
            <div className="min-w-0 flex-1 basis-56 sm:basis-0">
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
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Badge variant={member.role === "OWNER" ? "secondary" : "outline"}>
                {member.role === "OWNER" ? dict.owner : dict.contributor}
              </Badge>
              {isOwner && member.role !== "OWNER" && (
                <MemberActions
                  member={member}
                  dict={dict}
                  disabled={isPending}
                  onTransfer={() => setTransferTarget(member)}
                  onRemove={() => handleRemove(member.id)}
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
              <PendingLabel pending={isPending} busy={dict.transfer.transferring} idle={dict.transfer.confirmButton} />
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
              <PendingLabel pending={isPending} busy={dict.leave.leaving} idle={dict.leave.confirmButton} />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
