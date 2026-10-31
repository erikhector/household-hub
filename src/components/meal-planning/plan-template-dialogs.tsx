"use client";

import { useActionState, useTransition } from "react";
import { CalendarPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PendingLabel } from "@/components/ui/pending-label";
import { undoCopyWeekAction } from "@/app/dashboard/meal-planning/planner-actions";
import {
  applyMealPlanTemplateAction,
  deleteMealPlanTemplateAction,
  restoreMealPlanTemplateAction,
  saveWeekAsTemplateAction,
} from "@/app/dashboard/meal-planning/template-actions";
import { PLAN_TEMPLATE_NAME_MAX_LENGTH } from "@/app/dashboard/meal-planning/plan-template-calc";
import type { PlanTemplateSummary } from "@/components/meal-planning/types";
import type { ActionState } from "@/lib/actions/auth";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-52: the UI half of meal-plan templates. Both dialogs are mounted by
// WeekPlanner only while open (opened from the ⋯ menu, which unmounts as it
// closes), so each opens with fresh state.

type TemplatesDict = Dictionary["mealPlanning"]["templates"];

const initialState: ActionState = {};

/** "Save week as template": names the shown week's meals and stores them. */
export function SaveWeekTemplateDialog({
  dict,
  weekStartKey,
  onClose,
}: {
  dict: TemplatesDict;
  weekStartKey: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await saveWeekAsTemplateAction(prevState, formData);
    if (!result.error) {
      onClose();
      toast.success(format(dict.savedToast, { name: String(formData.get("name") ?? "").trim() }));
    }
    return result;
  }, initialState);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.saveTitle}</DialogTitle>
          <DialogDescription>{dict.saveDescription}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="weekStartDate" value={weekStartKey} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-template-name">{dict.nameLabel}</Label>
            <Input
              autoComplete="off"
              enterKeyHint="done"
              id="plan-template-name"
              name="name"
              maxLength={PLAN_TEMPLATE_NAME_MAX_LENGTH}
              required
              autoFocus
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {dict.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.saving} idle={dict.save} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateRow({
  template,
  weekStartKey,
  dict,
  onApplied,
}: {
  template: PlanTemplateSummary;
  weekStartKey: string;
  dict: TemplatesDict;
  onApplied: () => void;
}) {
  const [pending, startTransition] = useTransition();

  // Suggest, don't mutate: this button is the confirmation. The Undo takes
  // back exactly the entries this stamp wrote, by id, like Copy last week.
  const apply = () =>
    startTransition(async () => {
      const result = await applyMealPlanTemplateAction(template.id, weekStartKey);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      onApplied();
      const entryIds = result.entryIds ?? [];
      if (entryIds.length === 0) {
        toast(dict.nothingToast);
        return;
      }
      toast.success(format(plural(entryIds.length, dict.appliedToast), { count: entryIds.length }), {
        duration: 8000,
        action: {
          label: dict.undo,
          onClick: () => {
            void undoCopyWeekAction(entryIds).then((undoResult) => {
              if (undoResult.error) toast.error(undoResult.error);
              else toast.success(dict.undoneToast);
            });
          },
        },
      });
    });

  // Undo over confirm: the template is gone at once and the toast's Undo
  // recreates it from the snapshot the action handed back.
  const remove = () =>
    startTransition(async () => {
      const result = await deleteMealPlanTemplateAction(template.id);
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
                  const undo = await restoreMealPlanTemplateAction(snapshot);
                  if (undo.error) toast.error(undo.error);
                }),
            }
          : undefined,
      });
    });

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words font-medium sm:line-clamp-1" title={template.name}>
          {template.name}
        </p>
        <p className="text-sm text-muted-foreground">
          {format(plural(template.entryCount, dict.entryCount), { count: template.entryCount })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={format(dict.useAriaLabel, { name: template.name })}
          onClick={apply}
        >
          <CalendarPlus className="size-3.5" />
          {dict.use}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={pending}
          aria-label={format(dict.deleteAriaLabel, { name: template.name })}
          onClick={remove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

/** "Plan from template": the household's saved weeks, one tap to stamp one. */
export function PlanFromTemplateDialog({
  dict,
  weekStartKey,
  templates,
  onClose,
}: {
  dict: TemplatesDict;
  weekStartKey: string;
  templates: PlanTemplateSummary[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.pickTitle}</DialogTitle>
          <DialogDescription>{dict.pickDescription}</DialogDescription>
        </DialogHeader>
        {templates.length === 0 && <p className="text-sm text-muted-foreground">{dict.pickEmpty}</p>}
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <TemplateRow
              key={template.id}
              template={template}
              weekStartKey={weekStartKey}
              dict={dict}
              onApplied={onClose}
            />
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{dict.close}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
