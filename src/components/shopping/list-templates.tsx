"use client";

import { useActionState, useState, useTransition } from "react";
import { ListPlus, ScrollText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogHandle,
} from "@/components/ui/dialog";
import {
  createListFromTemplateAction,
  deleteShoppingListTemplateAction,
  restoreShoppingListTemplateAction,
  saveAsTemplateAction,
} from "@/app/dashboard/shopping-list/template-actions";
import type { ActionState } from "@/lib/actions/auth";
import { format, plural } from "@/lib/i18n/format";
import { TEMPLATE_NAME_MAX_LENGTH } from "@/lib/shopping/list-templates";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-4: the UI half of shopping-list templates. Both pieces live here
// rather than in shopping-list-client.tsx / shopping-lists-overview.tsx so
// those (busy, often-edited) files only gain a menu item and a mount point.

type TemplatesDict = Dictionary["shoppingList"]["templates"];

const initialState: ActionState = {};

/**
 * "Save as template", opened from a list's ⋯ menu through `handle` (the
 * menu unmounts as it closes, see createDialogHandle). The name defaults to
 * the list's own, since "BBQ" saved from the "BBQ" list is the usual case.
 */
export function SaveTemplateDialog({
  listId,
  listName,
  dict,
  handle,
}: {
  listId: string;
  listName: string;
  dict: TemplatesDict;
  handle: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await saveAsTemplateAction(prevState, formData);
    if (!result.error) {
      setOpen(false);
      toast.success(format(dict.savedToast, { name: String(formData.get("name") ?? "").trim() }));
    }
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.dialogTitle}</DialogTitle>
          <DialogDescription>{dict.dialogDescription}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="listId" value={listId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-name">{dict.nameLabel}</Label>
            <Input
              enterKeyHint="done"
              id="template-name"
              name="name"
              defaultValue={listName}
              maxLength={TEMPLATE_NAME_MAX_LENGTH}
              required
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {dict.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? dict.saving : dict.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type TemplateSummary = { id: string; name: string; itemCount: number };

function TemplateRow({ template, dict }: { template: TemplateSummary; dict: TemplatesDict }) {
  const [isPending, startTransition] = useTransition();

  // createListFromTemplateAction redirects to the new list on success, so
  // there's only an error to handle here.
  const startFromTemplate = () =>
    startTransition(async () => {
      const result = await createListFromTemplateAction(template.id);
      if (result?.error) toast.error(result.error);
    });

  // Undo over confirm: the template is gone straight away and the toast's
  // Undo recreates it from the snapshot the action handed back.
  const deleteTemplate = () =>
    startTransition(async () => {
      const result = await deleteShoppingListTemplateAction(template.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const snapshot = result.snapshot;
      toast.success(format(dict.deletedToast, { name: template.name }), {
        action: snapshot
          ? {
              label: dict.undo,
              onClick: () =>
                startTransition(async () => {
                  const undo = await restoreShoppingListTemplateAction(snapshot);
                  if (undo.error) toast.error(undo.error);
                }),
            }
          : undefined,
      });
    });

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ScrollText className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium" title={template.name}>
            {template.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {format(plural(template.itemCount, dict.itemCount), { count: template.itemCount })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-label={format(dict.useAriaLabel, { name: template.name })}
          onClick={startFromTemplate}
        >
          <ListPlus className="size-3.5" />
          {dict.use}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={isPending}
          aria-label={format(dict.deleteAriaLabel, { name: template.name })}
          onClick={deleteTemplate}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** The overview page's "Templates" section; renders nothing with none saved. */
export function ListTemplatesSection({ templates, dict }: { templates: TemplateSummary[]; dict: TemplatesDict }) {
  if (templates.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{dict.sectionTitle}</p>
      <div className="flex flex-col gap-2">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} dict={dict} />
        ))}
      </div>
    </div>
  );
}
