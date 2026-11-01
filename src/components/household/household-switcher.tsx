"use client";

import { useState, type ComponentProps } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import { loadHouseholdSwitcherMenu } from "@/components/dashboard/lazy-shell";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type HouseholdOption = { id: string; name: string; role: string };

/**
 * The switcher's button. Rendered twice with the same look: here as the
 * stand-in every page ships, and inside the lazy menu (household-switcher-menu
 * .tsx) once its chunk is mounted, where Base UI adds its own props and ref.
 */
export function HouseholdSwitcherTrigger({
  current,
  dict,
  ...props
}: { current: HouseholdOption; dict: Dictionary["household"]["switcher"] } & ComponentProps<typeof Button>) {
  return (
    // UX-47: Button's base `shrink-0 whitespace-nowrap` beat the name's
    // `min-w-0 line-clamp-*`, so a long name kept its full width and
    // pushed the chevron and "+" off the phone (or over the page on
    // desktop). `shrink` + `whitespace-normal` let the trigger give
    // way so the name clamps; `title` carries the full name.
    <Button
      variant="ghost"
      className="h-auto min-w-0 shrink flex-col items-start px-2 py-1 text-left whitespace-normal max-sm:min-h-11 max-sm:justify-center"
      {...props}
    >
      {/* UX-158: on a phone the label is for screen readers only, so the
          header is one slim row instead of ~90 px of two lines above every
          title. The sidebar (sm and up) keeps it visible. */}
      <span className="text-xs font-medium text-muted-foreground max-sm:sr-only">{dict.label}</span>
      <span className="flex min-w-0 max-w-full items-center gap-1 font-semibold">
        <span className="min-w-0 line-clamp-2 break-words sm:line-clamp-1" title={current.name}>
          {current.name}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </span>
    </Button>
  );
}

export function HouseholdSwitcher({
  current,
  households,
  dict,
}: {
  current: HouseholdOption;
  households: HouseholdOption[];
  dict: Dictionary["household"]["switcher"];
}) {
  // PERF-27: the dropdown and the create form load on the first tap (see
  // household-switcher-menu.tsx). Until then the trigger is a stand-in that
  // asks for the real one, which mounts with its menu already open, so the
  // first tap still lands on the list. The chunk is normally fetched in idle
  // time long before that.
  const [requested, setRequested] = useState(false);

  return (
    // UX-46: no standalone "+" any more. On a phone it sat in the header of
    // every page and read as "add an item here" but created a household, so
    // "Create household" is the last item of the dropdown instead.
    <div className="flex w-full min-w-0 items-center gap-2">
      <LazyDialog
        loader={loadHouseholdSwitcherMenu}
        open={requested}
        onLoadError={() => setRequested(false)}
        fallback={
          <HouseholdSwitcherTrigger
            current={current}
            dict={dict}
            type="button"
            aria-haspopup="menu"
            onClick={() => setRequested(true)}
            {...preloadOnIntent(loadHouseholdSwitcherMenu)}
          />
        }
      >
        {(Menu) => <Menu current={current} households={households} dict={dict} />}
      </LazyDialog>
    </div>
  );
}
