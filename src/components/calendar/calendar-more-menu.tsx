"use client";

import { useState } from "react";
import { Ellipsis, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createDialogHandle } from "@/components/ui/dialog";
import { createLazyDialogLoader, LazyDialog, openLazyDialog, preloadOnIntent } from "@/components/ui/lazy-dialog";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-92: the import sheet loads on first use (PERF-26), so the page's own
// chunk carries only this menu.
const loadEventFileImportDialog = createLazyDialogLoader(() =>
  import("@/components/calendar/event-file-import-dialog").then((m) => m.EventFileImportDialog),
);

// GAP-92: the calendar page's ⋯ menu, beside "Add event" from `sm` and beside
// the title on a phone (where Add event floats in the thumb zone). It holds
// the rare actions, so the page keeps one primary (DESIGN.md, Hierarchy;
// M6). Today that's "Import from file"; it is always there, an empty
// calendar included, since filling one from a school's or club's file is
// exactly when it's wanted. The sheet is mounted outside the menu, whose
// popup unmounts as it closes, and opened through its handle.
export function CalendarMoreMenu({ dict }: { dict: Dictionary["calendar"] }) {
  const [importHandle] = useState(() => createDialogHandle());
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              tooltip={false}
              aria-label={dict.moreActions}
              className="shrink-0"
              {...preloadOnIntent(loadEventFileImportDialog)}
            >
              <Ellipsis className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openLazyDialog(importHandle)}>
            <Upload className="size-4" /> {dict.importFile.menuItem}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LazyDialog loader={loadEventFileImportDialog} handle={importHandle}>
        {(EventFileImport) => <EventFileImport dict={dict} handle={importHandle} />}
      </LazyDialog>
    </>
  );
}
