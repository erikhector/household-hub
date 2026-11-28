"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PendingLabel } from "@/components/ui/pending-label";
import {
  importEventFileAction,
  previewEventFileAction,
  type EventFilePreviewRow,
} from "@/app/dashboard/calendar/actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-92: "Import from file" in the calendar's ⋯ menu. Step one picks an
// .ics file and has the server read it; step two is the review list, where
// nothing has been saved yet and each event can be unticked. An event whose
// title and date are already in the calendar can't be ticked and says so:
// the server would skip it anyway. The file stays in memory here and goes to
// the server again with the ticked indexes, so the browser never sends an
// event back (see previewEventFileAction / importEventFileAction). Same
// shape as the Recipes tab's file import (recipe-file-import-dialog.tsx).
export function EventFileImportDialog({ dict, handle }: { dict: Dictionary["calendar"]; handle: DialogHandle }) {
  const t = dict.importFile;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<EventFilePreviewRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reading, startReading] = useTransition();
  const [importing, startImporting] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setRows(null);
    setSkipped(0);
    setSelected(new Set());
    setError(null);
  }

  // A closed sheet forgets the file, so reopening it starts clean.
  function handleOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  function readFile(picked: File) {
    reset();
    setFile(picked);
    startReading(async () => {
      const data = new FormData();
      data.set("file", picked);
      const result = await previewEventFileAction({}, data);
      if (result.error || !result.preview) {
        setError(result.error ?? t.errorUnsupported);
        setFile(null);
        // Lets the same file be picked again after fixing it.
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      setRows(result.preview.rows);
      setSkipped(result.preview.skipped);
      setSelected(new Set(result.preview.rows.filter((row) => !row.exists).map((row) => row.index)));
    });
  }

  function toggle(index: number, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  function importSelected() {
    if (!file) return;
    setError(null);
    startImporting(async () => {
      const data = new FormData();
      data.set("file", file);
      for (const index of selected) data.append("index", String(index));
      const result = await importEventFileAction({}, data);
      if (result.error || !result.imported) {
        setError(result.error ?? t.errorNoneSelected);
        return;
      }
      toast.success(format(plural(result.imported, t.toast), { count: result.imported }));
      handleOpenChange(false);
      router.refresh();
    });
  }

  const importable = rows?.filter((row) => !row.exists) ?? [];
  const existing = (rows?.length ?? 0) - importable.length;
  const allSelected = importable.length > 0 && selected.size === importable.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="event-file-input">{t.inputLabel}</Label>
            <input
              ref={inputRef}
              id="event-file-input"
              type="file"
              accept=".ics,text/calendar"
              disabled={reading}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) readFile(picked);
              }}
              className="block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium sm:text-sm"
            />
            {reading && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t.reading}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm font-medium">
                {format(plural(rows.length, t.found), { count: rows.length })}
                {existing > 0 && (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {format(plural(existing, t.existing), { count: existing })}
                  </span>
                )}
              </p>
              {importable.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(importable.map((row) => row.index)))}
                >
                  {allSelected ? t.selectNone : t.selectAll}
                </Button>
              )}
            </div>
            {skipped > 0 && (
              <p className="text-sm text-muted-foreground">{format(plural(skipped, t.skipped), { count: skipped })}</p>
            )}
            <ul className="divide-y rounded-md border">
              {rows.map((row) => (
                <li key={row.index}>
                  <label
                    className={
                      row.exists
                        ? "flex min-h-11 items-center gap-3 px-3 py-2"
                        : "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2"
                    }
                  >
                    <Checkbox
                      checked={selected.has(row.index)}
                      disabled={row.exists}
                      onChange={(event) => toggle(row.index, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">{row.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {row.dateLabel} · {row.timeLabel}
                        </span>
                        {row.repeatLabel && <Badge variant="outline">{row.repeatLabel}</Badge>}
                        {row.exists && <Badge variant="secondary">{t.exists}</Badge>}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {rows !== null && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={reset} disabled={importing}>
              {t.otherFile}
            </Button>
            <Button type="button" onClick={importSelected} disabled={importing || selected.size === 0}>
              <PendingLabel
                pending={importing}
                busy={t.importing}
                idle={format(plural(selected.size, t.submit), { count: selected.size })}
              />
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
