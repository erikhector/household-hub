"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Check, CheckCheck, PackageCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MascotMark } from "@/components/brand/mascot-empty-state";
import { ProgressRing } from "@/components/shopping/shopping-mode";
import { createShoppingListAction } from "@/app/dashboard/shopping-list/list-actions";
import { format, plural } from "@/lib/i18n/format";
import type { ShoppingProgress } from "@/lib/shopping/shopping-progress";
import type { ShoppingListDict } from "@/components/shopping/shopping-list-types";

/**
 * The "All done" moment: the ring full with a tick in it, and the one next
 * step as the primary action. UX-37: with ticked rows still waiting to be
 * put away (ON_PUT_AWAY households), that step is putting them away, which
 * finishes the list once confirmed; otherwise it's "Done shopping" (AUTO-5).
 * It pops in (motion-safe only).
 */
export function ClearedState({
  dict,
  progress,
  celebrate,
  onDismiss,
  onDone,
  awaitingPutAway,
  tripSummary,
  onPutAway,
  onReview,
  isPending,
}: {
  dict: ShoppingListDict;
  progress: ShoppingProgress;
  /** UX-38: the last item was just ticked here, so the squirrel fills the ring instead of the check. */
  celebrate: boolean;
  onDismiss: () => void;
  /** AUTO-5: completes the list in one tap, with Undo on the toast. */
  onDone?: () => void;
  awaitingPutAway: number;
  /** UX-81: the trip in one line. */
  tripSummary: string;
  /** Puts everything away with the defaults (and finishes the list). */
  onPutAway: () => void;
  /** Opens the put-away sheet instead, to adjust rows first. */
  onReview: () => void;
  isPending: boolean;
}) {
  return (
    <div className="list-bleed relative flex flex-col items-center gap-1.5 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
      {progress.total > 0 ? (
        // UX-38: on the tick that cleared the list, the squirrel rises into
        // the full ring once and then holds still: no confetti, sound or
        // count. It sits over the ring as a sibling, not inside it, because a
        // progressbar's children are hidden from screen readers and the mark
        // has a name to announce. motion-safe keeps it a static image under
        // prefers-reduced-motion.
        <div className="relative mb-2 grid place-items-center">
          <ProgressRing progress={progress} dict={dict.shoppingMode} className="size-20">
            {!celebrate && (
              <Check aria-hidden className="size-8 text-primary motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500" />
            )}
          </ProgressRing>
          {celebrate && (
            <MascotMark
              alt={dict.mascotAlt}
              className="absolute size-12 rounded-full motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:zoom-in-75 motion-safe:duration-700"
            />
          )}
        </div>
      ) : (
        <CheckCheck className="size-5 text-muted-foreground" />
      )}
      <p className="font-heading text-xl font-semibold">{dict.clearedTitle}</p>
      <p className="text-sm text-muted-foreground">
        {awaitingPutAway > 0
          ? format(plural(awaitingPutAway, dict.shoppingMode.waitingToPutAway), { count: awaitingPutAway })
          : dict.clearedDescription}
      </p>
      {progress.total > 0 && <p className="text-sm font-medium tabular-nums">{tripSummary}</p>}
      {awaitingPutAway > 0 ? (
        <>
          <Button className="mt-3" disabled={isPending} onClick={onPutAway}>
            <PackageCheck className="size-4" />
            {dict.putAway.everything}
          </Button>
          <Button variant="ghost" size="sm" disabled={isPending} onClick={onReview}>
            {dict.putAway.reviewFirst}
          </Button>
        </>
      ) : (
        onDone && (
          <Button className="mt-3" disabled={isPending} onClick={onDone}>
            {dict.doneShopping}
          </Button>
        )
      )}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-7 text-muted-foreground"
        aria-label={dict.clearedDismissAriaLabel}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * UX-81: where a finished trip lands. The list below it is the read-only,
 * struck-through record; this card says the trip is over and offers the two
 * places to go next. "Start next list" opens the household's active default
 * list when there is one (where unbought rows were carried to), and only
 * creates a fresh dated list when there isn't.
 */
export function CompletedActions({
  dict,
  tripSummary,
  nextListId,
}: {
  dict: ShoppingListDict;
  tripSummary: string;
  nextListId: string | null;
}) {
  const [, createAction, creating] = useActionState(createShoppingListAction, {});
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div>
        <p className="font-heading text-lg font-semibold">{dict.tripCompleteTitle}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{tripSummary}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {nextListId ? (
          <Button render={<Link href={`/dashboard/shopping-list/${nextListId}`} />}>{dict.startNextList}</Button>
        ) : (
          <form action={createAction}>
            <Button type="submit" disabled={creating}>
              {dict.startNextList}
            </Button>
          </form>
        )}
        <Button variant="outline" render={<Link href="/dashboard/shopping-list" />}>
          {dict.backToLists}
        </Button>
      </div>
    </div>
  );
}
