"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Ellipsis, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { archiveListWithUndo } from "@/components/shopping/archive-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  createDialogHandle,
} from "@/components/ui/dialog";
import {
  createShoppingListAction,
  deleteShoppingListAction,
  unarchiveShoppingListAction,
} from "@/app/dashboard/shopping-list/actions";
import type { ActionState } from "@/lib/actions/auth";
import { datedName, format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { Radio } from "@/components/ui/radio";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export type StartSource = { id: string; name: string };
/** A recent list, with how many of its rows are still to buy. */
export type RecentListSource = StartSource & { unbought: number };

// UX-85: what "Start from" holds is `blank`, `template:<id>` or `list:<id>`,
// the format createShoppingListAction reads.
const BLANK_START = "blank";

export function NewListDialog({
  dict,
  locale,
  templates = [],
  recentLists = [],
}: {
  dict: ShoppingListDict;
  locale: Locale;
  templates?: StartSource[];
  recentLists?: RecentListSource[];
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(BLANK_START);
  const [copy, setCopy] = useState<"unbought" | "all">("unbought");
  const startLabels = new Map<string, string>([
    [BLANK_START, dict.startFrom.blank],
    ...templates.map((t) => [`template:${t.id}`, t.name] as const),
    ...recentLists.map((l) => [`list:${l.id}`, l.name] as const),
  ]);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createShoppingListAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  // Picking a past list defaults to what's still to buy, unless nothing is:
  // a finished trip has every row ticked, and copying "only what is still
  // to buy" from it would make an empty list.
  const chooseStart = (value: string) => {
    setStart(value);
    const list = recentLists.find((l) => `list:${l.id}` === value);
    if (list) setCopy(list.unbought > 0 ? "unbought" : "all");
  };
  // With no name typed, a template's list takes the template's name, so the
  // placeholder shows that rather than the dated default.
  const namePlaceholder = start.startsWith("template:")
    ? (startLabels.get(start) ?? datedName(dict.defaultNamePrefix, locale))
    : datedName(dict.defaultNamePrefix, locale);

  // Back to a blank list each time the sheet opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setStart(BLANK_START);
      setCopy("unbought");
    }
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              placeholder={namePlaceholder}
              maxLength={120}
            />
          </div>
          {startLabels.size > 1 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-list-start">{dict.startFrom.label}</Label>
              <input type="hidden" name="start" value={start} />
              <Select value={start} onValueChange={(v) => chooseStart(v ?? BLANK_START)}>
                <SelectTrigger id="new-list-start" className="w-full">
                  <SelectValue>{(value: string) => startLabels.get(value) ?? dict.startFrom.blank}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BLANK_START}>{dict.startFrom.blank}</SelectItem>
                  {templates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{dict.startFrom.templatesGroup}</SelectLabel>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={`template:${t.id}`}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {recentLists.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{dict.startFrom.recentGroup}</SelectLabel>
                      {recentLists.map((l) => (
                        <SelectItem key={l.id} value={`list:${l.id}`}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          {start.startsWith("list:") && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-medium">{dict.startFrom.itemsLabel}</legend>
              {(["unbought", "all"] as const).map((value) => (
                <label key={value} className="flex items-center gap-3 text-sm">
                  <Radio
                    name="items"
                    value={value}
                    checked={copy === value}
                    onChange={() => setCopy(value)}
                  />
                  {value === "unbought" ? dict.startFrom.itemsUnbought : dict.startFrom.itemsAll}
                </label>
              ))}
            </fieldset>
          )}
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
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
  const [deleteHandle] = useState(() => createDialogHandle());

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
        {/* UX-49: Archive and Delete behind one ⋯ menu, no longer two
            lookalike icons side by side. Archive is undoable from its
            toast; Delete keeps its confirm, since it takes the list's
            items with it. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" disabled={isPending} aria-label={dict.moreActions}>
                <Ellipsis className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {list.status !== "ARCHIVED" ? (
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    await archiveListWithUndo(list.id, dict);
                  })
                }
              >
                <Archive />
                {dict.archive}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  startTransition(async () => {
                    const result = await unarchiveShoppingListAction(list.id);
                    if (result.error) toast.error(result.error);
                  })
                }
              >
                <ArchiveRestore />
                {dict.unarchive}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => deleteHandle.open(null)}>
              <Trash2 />
              {dict.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ConfirmDialog
          handle={deleteHandle}
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
  emptyAction,
}: {
  /** UX-50: the "New list" trigger the empty state holds. */
  emptyAction?: ReactNode;
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
    <MascotEmptyState alt={dict.mascotAlt} action={emptyAction}>
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
