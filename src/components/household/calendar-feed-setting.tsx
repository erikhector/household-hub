"use client";

import { useTransition } from "react";
import { CalendarDays, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  disableCalendarFeedAction,
  enableCalendarFeedAction,
  regenerateCalendarFeedAction,
} from "@/lib/actions/household";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-3's Household page card. `feedUrl` is null while the feed is off. The
// URL is built on the server (see calendarFeedUrl in the Household page) so
// it's already absolute on first render and needs no window.location.
//
// Every member sees the link once it's on; only the owner gets the
// enable/regenerate/disable controls (the actions enforce that server-side
// too, see setCalendarFeedToken). Regenerate and disable both break every
// existing subscription, so both go through a confirm dialog; enabling
// can't break anything, so it's a plain click.
export function CalendarFeedSetting({
  feedUrl,
  isOwner,
  dict,
}: {
  feedUrl: string | null;
  isOwner: boolean;
  dict: Dictionary["household"]["calendarFeed"];
}) {
  const [isEnabling, startEnable] = useTransition();

  function handleEnable() {
    startEnable(async () => {
      const result = await enableCalendarFeedAction();
      if (result.error) toast.error(result.error);
      else toast.success(dict.enabledToast);
    });
  }

  // webcal:// is the scheme calendar apps register for "subscribe to this
  // feed", so tapping it on a phone opens the subscribe prompt directly
  // instead of downloading a one-off .ics file. Same host and path, only the
  // scheme swapped.
  const webcalUrl = feedUrl?.replace(/^https?:\/\//, "webcal://") ?? null;

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 font-heading text-base font-semibold">
          <CalendarDays className="size-4 shrink-0" />
          {dict.title}
        </h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>
      {/* Shown whether the feed is on or off: the owner should read it
          before turning the feed on, not only after. */}
      <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{dict.publicWarning}</span>
      </p>
      {feedUrl && webcalUrl ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              readOnly
              className="min-w-[12rem] flex-1"
              value={feedUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={dict.linkAriaLabel}
            />
            <CopyLinkButton url={feedUrl} dict={dict} shareTitle={dict.title} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" render={<a href={webcalUrl} />}>
              {dict.openInCalendar}
            </Button>
            {isOwner && (
              <>
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {dict.regenerate}
                    </Button>
                  }
                  title={dict.regenerateConfirm.title}
                  description={dict.regenerateConfirm.description}
                  cancelLabel={dict.regenerateConfirm.cancel}
                  confirmLabel={dict.regenerateConfirm.confirm}
                  pendingLabel={dict.regenerateConfirm.confirming}
                  variant="default"
                  onConfirm={async () => {
                    const result = await regenerateCalendarFeedAction();
                    if (!result.error) toast.success(dict.regeneratedToast);
                    return result;
                  }}
                />
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      {dict.disable}
                    </Button>
                  }
                  title={dict.disableConfirm.title}
                  description={dict.disableConfirm.description}
                  cancelLabel={dict.disableConfirm.cancel}
                  confirmLabel={dict.disableConfirm.confirm}
                  pendingLabel={dict.disableConfirm.confirming}
                  onConfirm={async () => {
                    const result = await disableCalendarFeedAction();
                    if (!result.error) toast.success(dict.disabledToast);
                    return result;
                  }}
                />
              </>
            )}
          </div>
        </>
      ) : isOwner ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">{dict.offDescription}</p>
          <Button type="button" variant="secondary" disabled={isEnabling} onClick={handleEnable}>
            {isEnabling ? dict.enabling : dict.enable}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{dict.contributorOffDescription}</p>
      )}
    </div>
  );
}
