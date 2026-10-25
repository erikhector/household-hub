"use client";

// UX-136: "Clear sample data" deletes rows, and a sample row the person has
// since edited or completed keeps its tag and goes too, so the click opens
// the shared ConfirmDialog first (DESIGN.md: destructive actions are
// confirmed or undoable). The dialog says what goes, including edited rows.

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearSampleDataAction } from "@/lib/actions/sample-data";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function ClearSampleDataButton({ dict }: { dict: Dictionary["dashboard"]["sampleData"] }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="w-full sm:w-auto">
          {dict.clearButton}
        </Button>
      }
      title={dict.confirmTitle}
      description={dict.confirmDescription}
      cancelLabel={dict.confirmCancel}
      confirmLabel={dict.confirmConfirm}
      pendingLabel={dict.confirmPending}
      onConfirm={() => clearSampleDataAction()}
    />
  );
}
