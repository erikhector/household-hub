"use client";

import { toast } from "sonner";
import { archiveShoppingListAction, unarchiveShoppingListAction } from "@/app/dashboard/shopping-list/actions";

// UX-49: archiving a list used to be silent. It's one tap and easily
// mistaken for something else, so it now says what happened and offers the
// way back (DESIGN.md: prefer undo for frequent, low-stakes actions).
// Archiving is a status change, so Undo is the ordinary unarchive.
export async function archiveListWithUndo(
  listId: string,
  dict: { listArchivedToast: string; undo: string },
): Promise<void> {
  const result = await archiveShoppingListAction(listId);
  if (result.error) {
    toast.error(result.error);
    return;
  }
  toast(dict.listArchivedToast, {
    action: {
      label: dict.undo,
      onClick: () => {
        void unarchiveShoppingListAction(listId).then((undone) => {
          if (undone.error) toast.error(undone.error);
        });
      },
    },
  });
}
