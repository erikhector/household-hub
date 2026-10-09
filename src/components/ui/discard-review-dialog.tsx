"use client";

// The "throw this away?" question for a scan/receipt review dialog (UX-22).
// By the time a review is on screen the photo has been read (and, for the
// AI scans, paid for), so a stray back swipe, backdrop tap or Cancel must
// not silently drop it: the person would have to re-photograph and trigger
// the AI call again. The owning dialog stays open underneath and is only
// closed from `onDiscard`. Controlled, unlike ConfirmDialog, because it's
// opened by an attempt to close another dialog rather than by its own
// trigger.

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DiscardReviewDict = {
  title: string;
  description: string;
  keep: string;
  discard: string;
};

export function DiscardReviewDialog({
  open,
  onOpenChange,
  dict,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dict: DiscardReviewDict;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.title}</DialogTitle>
          <DialogDescription>{dict.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* "Keep reviewing" is the safe default, so it's the outline
              button and discard is the destructive one. */}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {dict.keep}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onDiscard();
            }}
          >
            {dict.discard}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
