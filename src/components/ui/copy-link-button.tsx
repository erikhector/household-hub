"use client";

import { useSyncExternalStore } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type CopyLinkDict = {
  copy: string;
  copiedToast: string;
  copyFailedToast: string;
  share: string;
};

const subscribeNever = () => () => {};

export function canNativeShare() {
  return typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * The "Copy" button beside a read-only link (invite, shopping-list share,
 * calendar feed). `clipboard.writeText` returns a promise that rejects when
 * the page isn't focused, the context isn't secure or the permission is
 * denied, so the success toast waits for it: a toast saying "copied" over
 * an empty clipboard sends the user off to paste nothing. On a failure the
 * error toast points at the field next to the button, whose text is
 * selected on focus, so the link can still be copied by hand.
 *
 * On a phone with the Web Share API a second "Share" button hands the link
 * to the system share sheet (messages, mail, AirDrop), which is how a
 * phone user actually sends an invite. It's detected after mount, and only
 * for a coarse pointer, because desktop Chrome and Safari also expose
 * `navigator.share` and a share sheet is the wrong tool with a mouse.
 */
export function CopyLinkButton({
  url,
  dict,
  shareTitle,
}: {
  url: string;
  dict: CopyLinkDict;
  shareTitle: string;
}) {
  // useSyncExternalStore gives the server/hydration pass `false` and then
  // the real answer, without a set-state-in-effect.
  const canShare = useSyncExternalStore(subscribeNever, canNativeShare, () => false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(dict.copiedToast);
    } catch {
      toast.error(dict.copyFailedToast);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: shareTitle, url });
    } catch (err) {
      // Closing the sheet rejects with AbortError: that's a choice, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error(dict.copyFailedToast);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={copy}>
        {dict.copy}
      </Button>
      {canShare && (
        <Button type="button" variant="secondary" onClick={share}>
          <Share2 className="size-4" />
          {dict.share}
        </Button>
      )}
    </>
  );
}
