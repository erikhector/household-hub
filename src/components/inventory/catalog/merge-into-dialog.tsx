"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ItemCombobox } from "@/components/inventory/item-combobox";
import { MergePreviewBody } from "@/components/inventory/catalog/merge-preview";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { format } from "@/lib/i18n/format";
import { itemPageHref, type ItemPageOrigin } from "@/lib/inventory/item-page-origin";

// "Merge into another item…" on the item page (MATCH-7, design §6.1 and
// §6.3): pick the item to keep, then the same preview and confirm as the
// catalog's duplicate groups. This item is the one that goes, so a merge
// ends on the kept item's page, carrying this page's origin along so its
// back arrow still goes where this one's did.
export function MergeIntoDialog({
  item,
  origin,
  targets,
  dict,
  locale,
}: {
  item: { id: string; name: string };
  origin: ItemPageOrigin;
  targets: { id: string; label: string }[];
  dict: Dictionary["inventory"]["catalog"];
  locale: Locale;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const target = targets.find((candidate) => candidate.id === targetId);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setTargetId("");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" className="h-auto max-w-full min-h-8 w-fit py-1 whitespace-normal">
            {dict.mergeInto}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(dict.mergeIntoTitle, { name: item.name })}</DialogTitle>
          <DialogDescription>{format(dict.mergeIntoDescription, { name: item.name })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="merge-into-target">{dict.targetLabel}</Label>
          <ItemCombobox
            id="merge-into-target"
            items={targets}
            value={targetId}
            onValueChange={setTargetId}
            placeholder={dict.targetPlaceholder}
            emptyMessage={dict.noMatches}
          />
        </div>
        {/* Until an item is picked, the preview (and its buttons) can't load,
            but the way out and the next step are shown from the start: Cancel,
            and Merge disabled until there's something to merge into (UX-11). */}
        {!target && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {dict.mergeDialog.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled>
              {dict.mergeDialog.merge}
            </Button>
          </DialogFooter>
        )}
        {target && (
          <MergePreviewBody
            key={target.id}
            keeperId={target.id}
            mergeIds={[item.id]}
            dict={dict}
            locale={locale}
            onCancel={() => setOpen(false)}
            onMerged={() => {
              setOpen(false);
              router.replace(itemPageHref(target.id, origin));
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
