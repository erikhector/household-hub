"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio } from "@/components/ui/radio";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  archiveShoppingListAction,
  createShoppingListAction,
  deleteShoppingListAction,
  unarchiveShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";
import { datedName, format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { PendingLabel } from "@/components/ui/pending-label";
import { useFlipList } from "@/components/shared/use-flip-list";
import { MorphTitle } from "@/components/shared/view-transitions";
import { MascotEmptyState } from "@/components/brand/mascot-empty-state";

type ListSummary = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  isDefault: boolean;
  pendingItemCount: number;
};

type ShoppingListDict = Dictionary["shoppingList"];

const initialState: ActionState = {};

type StartFrom = "blank" | "template" | "list";
type ListScope = "unbought" | "all";

export type StartSource = { id: string; name: string };

/**
 * UX-85: the New list sheet. Besides the name it asks where the rows come
 * from (DESIGN.md M4: pick, don't type): nothing, a saved template, or a
 * recent list, with its unbought items or all of them. An option with
 * nothing to offer (no templates, no recent lists) isn't shown, so a
 * first-time household still sees a one-field sheet.
 */
export function NewListDialog({
  dict,
  locale,
  templates,
  recentLists,
}: {
  dict: ShoppingListDict;
  locale: Locale;
  templates: StartSource[];
  recentLists: StartSource[];
}) {
  const [open, setOpen] = useState(false);
  const [startFrom, setStartFrom] = useState<StartFrom>("blank");
  // The first of each is pre-selected, so choosing a source is one tap.
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [sourceListId, setSourceListId] = useState(recentLists[0]?.id ?? "");
  const [listScope, setListScope] = useState<ListScope>("unbought");
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createShoppingListAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  const sd = dict.startFrom;
  const options: { value: StartFrom; label: string }[] = [
    { value: "blank", label: sd.blank },
    ...(templates.length > 0 ? [{ value: "template" as const, label: sd.template }] : []),
    ...(recentLists.length > 0 ? [{ value: "list" as const, label: sd.recentList }] : []),
  ];
  const sourceSelect = (
    id: string,
    label: string,
    sources: StartSource[],
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{(v: string) => sources.find((source) => source.id === v)?.name ?? v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sources.map((source) => (
            <SelectItem key={source.id} value={source.id}>
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStartFrom("blank");
          setListScope("unbought");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            {dict.newList}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.newListDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-list-name">{dict.nameLabel}</Label>
            <Input
              autoComplete="off"
              enterKeyHint="done"
              id="new-list-name"
              name="name"
              placeholder={datedName(dict.defaultNamePrefix, locale)}
              maxLength={120}
            />
          </div>
          {options.length > 1 && (
            <>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{sd.label}</legend>
                {options.map((option) => (
                  <label key={option.value} className="flex min-h-11 items-center gap-3 text-sm">
                    <Radio
                      name="startFrom"
                      value={option.value}
                      checked={startFrom === option.value}
                      onChange={() => setStartFrom(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              {startFrom === "template" && (
                <>
                  {sourceSelect("new-list-template", sd.pickTemplate, templates, templateId, setTemplateId)}
                  <input type="hidden" name="templateId" value={templateId} />
                </>
              )}
              {startFrom === "list" && (
                <>
                  {sourceSelect("new-list-source", sd.pickList, recentLists, sourceListId, setSourceListId)}
                  <input type="hidden" name="sourceListId" value={sourceListId} />
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium">{sd.scopeLabel}</legend>
                    {(["unbought", "all"] as const).map((scope) => (
                      <label key={scope} className="flex min-h-11 items-center gap-3 text-sm">
                        <Radio
                          name="listScope"
                          value={scope}
                          checked={listScope === scope}
                          onChange={() => setListScope(scope)}
                        />
                        {scope === "unbought" ? sd.scopeUnbought : sd.scopeAll}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
            </>
          )}
          {state.error &&<p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              <PendingLabel pending={pending} busy={dict.creating} idle={dict.create} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListCard({ list, dict }: { list: ListSummary; dict: ShoppingListDict }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div data-flip-key={list.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <Link
        href={`/dashboard/shopping-list/${list.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <ShoppingCart className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {/* UX-33: flies up into the list page's title on the way in. */}
            <MorphTitle kind="shopping-list" id={list.id}>
              <p className="line-clamp-2 break-words sm:line-clamp-1 font-medium" title={list.name}>{list.name}</p>
            </MorphTitle>
            {list.isDefault && (
              <Badge variant="secondary" className="shrink-0" title={dict.defaultListHint}>
                {dict.defaultListBadge}
              </Badge>
            )}
          </div>
          {list.status === "ACTIVE" ? (
            <p className="text-sm text-muted-foreground">
              {format(plural(list.pendingItemCount, dict.itemsToBuy), {
                count: list.pendingItemCount,
              })}
            </p>
          ) : (
            <Badge variant="secondary">
              {list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived}
            </Badge>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1">
        {list.status !== "ARCHIVED" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label={dict.archiveAriaLabel}
            onClick={() =>
              startTransition(async () => {
                const result = await archiveShoppingListAction(list.id);
                if (result.error) toast.error(result.error);
              })
            }
          >
            <Archive className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isPending}
            aria-label={dict.unarchiveAriaLabel}
            onClick={() =>
              startTransition(async () => {
                const result = await unarchiveShoppingListAction(list.id);
                if (result.error) toast.error(result.error);
              })
            }
          >
            <ArchiveRestore className="size-3.5" />
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={isPending}
              aria-label={dict.deleteAriaLabel}
            >
              <Trash2 className="size-3.5" />
            </Button>
          }
          title={format(dict.confirmDeleteList.title, { name: list.name })}
          description={dict.confirmDeleteList.description}
          cancelLabel={dict.confirmDeleteList.cancel}
          confirmLabel={dict.confirmDeleteList.confirm}
          pendingLabel={dict.confirmDeleteList.confirming}
          onConfirm={() => deleteShoppingListAction(list.id)}
        />
      </div>
    </div>
  );
}

function ListSection({
  title,
  lists,
  dict,
}: {
  title: string;
  lists: ListSummary[];
  dict: ShoppingListDict;
}) {
  if (lists.length === 0) return null;
  return (
    <div data-flip-key={`section:${title}`} className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="list-bleed relative flex flex-col gap-2">
        {lists.map((list) => (
          <ListCard key={list.id} list={list} dict={dict} />
        ))}
      </div>
    </div>
  );
}

export function ShoppingListsOverview({
  active,
  completed,
  archived,
  dict,
}: {
  active: ListSummary[];
  completed: ListSummary[];
  archived: ListSummary[];
  dict: ShoppingListDict;
}) {
  const isEmpty = active.length === 0 && completed.length === 0 && archived.length === 0;
  // UX-33: completing, archiving or deleting a list glides its card into
  // place (or out) instead of jumping, once the server answers.
  const containerRef = useFlipList<HTMLDivElement>();

  return isEmpty ? (
    <MascotEmptyState alt={dict.mascotAlt}>
      <p className="text-sm text-muted-foreground">{dict.empty}</p>
    </MascotEmptyState>
  ) : (
    <div ref={containerRef} className="flex flex-col gap-6">
      <ListSection title={dict.sectionActive} lists={active} dict={dict} />
      <ListSection title={dict.sectionCompleted} lists={completed} dict={dict} />
      <ListSection title={dict.sectionArchived} lists={archived} dict={dict} />
    </div>
  );
}
