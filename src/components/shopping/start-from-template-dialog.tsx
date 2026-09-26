"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, NotebookText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createListFromTemplateAction,
  deleteShoppingListTemplateAction,
} from "@/app/dashboard/shopping-list/actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type ShoppingListTemplateSummary = { id: string; name: string; itemCount: number };

/**
 * GAP-4's "Start from template" — lists the household's saved templates
 * (see SaveAsTemplateDialog for how they're created) and spins one into a
 * fresh ACTIVE list via createListFromTemplateAction, which redirects
 * straight to it on success — same "just call it, the redirect takes over"
 * shape as deleteShoppingListAction's ConfirmDialog usage elsewhere, no
 * special-casing needed here. Deleting a template needs its own confirm
 * (unlike "Use", it can't be undone), but stays inside this same dialog
 * rather than opening a second one.
 */
export function StartFromTemplateDialog({
  templates,
  dict,
}: {
  templates: ShoppingListTemplateSummary[];
  dict: Dictionary["shoppingList"]["templates"];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [usingId, setUsingId] = useState<string | null>(null);

  const startFromTemplate = (templateId: string) => {
    setUsingId(templateId);
    startTransition(async () => {
      const result = await createListFromTemplateAction(templateId);
      // Only reached on failure — success redirects away before returning.
      if (result.error) {
        toast.error(result.error);
        setUsingId(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <NotebookText className="size-4" />
            {dict.triggerLabel}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
        </DialogHeader>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.empty}</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={template.name}>
                    {template.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(plural(template.itemCount, dict.itemCount), { count: template.itemCount })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => startFromTemplate(template.id)}
                  >
                    {isPending && usingId === template.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      dict.useButton
                    )}
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={isPending}
                        aria-label={format(dict.deleteAriaLabel, { name: template.name })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    }
                    title={format(dict.confirmDelete.title, { name: template.name })}
                    description={dict.confirmDelete.description}
                    cancelLabel={dict.confirmDelete.cancel}
                    confirmLabel={dict.confirmDelete.confirm}
                    pendingLabel={dict.confirmDelete.confirming}
                    onConfirm={async () => {
                      const result = await deleteShoppingListTemplateAction(template.id);
                      if (!result.error) toast.success(dict.deletedToast);
                      return result;
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
