"use client";

// GAP-16: the shared household notes board on the Household page — a flat,
// reverse-chronological list with an add form above it. Add + delete only:
// pin to the top (GAP-61), no edit or rich text (see notes-actions.ts). Same simple
// shape as TasksClient's list rows, and delete goes through the shared
// ConfirmDialog like every other removal in the app.

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createNoteAction, deleteNoteAction, setNotePinnedAction } from "@/app/dashboard/household/notes-actions";
import type { ActionState } from "@/lib/actions/auth";
import { NOTE_BODY_MAX_LENGTH } from "@/lib/household-notes";
import { format } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { PendingLabel } from "@/components/ui/pending-label";

type NotesDict = Dictionary["household"]["notes"];

export type HouseholdNoteRow = {
  id: string;
  body: string;
  // Null once the author has left the household (authorMemberId is
  // onDelete: SetNull) — rendered as dict.formerMember.
  authorName: string | null;
  createdAt: Date;
  pinned: boolean;
};

const initialState: ActionState = {};

export function HouseholdNotes({
  notes,
  dict,
  locale,
}: {
  notes: HouseholdNoteRow[];
  dict: NotesDict;
  locale: Locale;
}) {
  // Controlled rather than relying on React 19's automatic form reset: that
  // reset also fires when the action returns a validation error, which would
  // throw away what the user typed. Clearing it only on success keeps it.
  const [body, setBody] = useState("");
  const [pinPending, startPin] = useTransition();
  function togglePin(note: HouseholdNoteRow) {
    startPin(async () => {
      const result = await setNotePinnedAction(note.id, !note.pinned);
      if (result.error) toast.error(result.error);
    });
  }
  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await createNoteAction(prevState, formData);
    if (result.error) {
      toast.error(result.error);
    } else {
      setBody("");
      toast.success(dict.addedToast);
    }
    return result;
  }, initialState);

  // Year only when it isn't this year's — most notes are about this week,
  // and "12 Mar 2025" on every row would be noise.
  const currentYear = new Date().getFullYear();
  function formatDate(date: Date) {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() !== currentYear ? { year: "numeric" } : {}),
    }).format(date);
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
        <p className="text-sm text-muted-foreground">{dict.description}</p>
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <Label htmlFor="household-note-body" className="sr-only">
          {dict.bodyLabel}
        </Label>
        <Textarea
          autoComplete="off"
          id="household-note-body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={dict.placeholder}
          maxLength={NOTE_BODY_MAX_LENGTH}
          aria-invalid={state.error ? true : undefined}
          rows={2}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" disabled={pending || body.trim().length === 0}>
            <PendingLabel pending={pending} busy={dict.adding} idle={dict.add} />
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {dict.emptyState}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => {
            const authorName = note.authorName ?? dict.formerMember;
            return (
              <li key={note.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* whitespace-pre-wrap keeps the line breaks people type
                      (a short list, an address); break-words stops a long
                      URL from overflowing the card on a phone. */}
                  <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {note.pinned ? (
                      <span className="mr-1 inline-flex items-center gap-1 font-medium text-foreground">
                        <Pin className="size-3" aria-hidden="true" />
                        {dict.pinned}
                        <span aria-hidden="true"> ·</span>
                      </span>
                    ) : null}
                    {format(dict.byline, { name: authorName, date: formatDate(note.createdAt) })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground"
                  disabled={pinPending}
                  aria-pressed={note.pinned}
                  aria-label={format(note.pinned ? dict.unpinAriaLabel : dict.pinAriaLabel, { name: authorName })}
                  onClick={() => togglePin(note)}
                >
                  {note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={format(dict.deleteAriaLabel, { name: authorName })}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                  title={dict.confirmDelete.title}
                  description={dict.confirmDelete.description}
                  cancelLabel={dict.confirmDelete.cancel}
                  confirmLabel={dict.confirmDelete.confirm}
                  pendingLabel={dict.confirmDelete.confirming}
                  onConfirm={() => deleteNoteAction(note.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
