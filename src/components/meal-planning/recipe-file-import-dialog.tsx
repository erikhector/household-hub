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
  importRecipesFromFileAction,
  previewRecipeFileAction,
  type RecipeFilePreviewRow,
} from "@/app/dashboard/meal-planning/recipe-file-actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type MealPlanningDict = Dictionary["mealPlanning"];

// GAP-67: "Import from a file" on the Recipes tab. Step one picks a Paprika
// export or a recipe JSON file and has the server read it; step two is the
// review list, where nothing has been saved yet and each recipe can be
// unticked (names already in the household start unticked and say so). The
// file stays in memory here and goes to the server again with the ticked
// indexes, so the browser never sends recipe content back. See
// recipe-file-actions.ts.
export function RecipeFileImportDialog({ dict, handle }: { dict: MealPlanningDict; handle: DialogHandle }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<RecipeFilePreviewRow[] | null>(null);
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

  // A closed dialog forgets the file, so reopening it starts clean.
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
      const result = await previewRecipeFileAction({}, data);
      if (result.error || !result.preview) {
        setError(result.error ?? dict.importFileErrorUnsupported);
        setFile(null);
        // Lets the same file be picked again after fixing it.
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      setRows(result.preview.recipes);
      setSkipped(result.preview.skipped);
      setSelected(new Set(result.preview.recipes.filter((row) => !row.exists).map((row) => row.index)));
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
      const result = await importRecipesFromFileAction({}, data);
      if (result.error || !result.imported) {
        setError(result.error ?? dict.importFileErrorNoneSelected);
        return;
      }
      toast.success(format(plural(result.imported, dict.importFileToast), { count: result.imported }));
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.importFileTitle}</DialogTitle>
          <DialogDescription>{dict.importFileDescription}</DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="recipe-file-input">{dict.importFileInputLabel}</Label>
            <input
              ref={inputRef}
              id="recipe-file-input"
              type="file"
              accept=".paprikarecipes,.json,.zip,application/json,application/zip"
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
                {dict.importFileReading}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p role="status" className="text-sm font-medium">
                {format(plural(rows.length, dict.importFileFound), { count: rows.length })}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.index)))}
              >
                {selected.size === rows.length ? dict.importFileSelectNone : dict.importFileSelectAll}
              </Button>
            </div>
            {skipped > 0 && (
              <p className="text-sm text-muted-foreground">
                {format(plural(skipped, dict.importFileSkipped), { count: skipped })}
              </p>
            )}
            <ul className="max-h-[45vh] divide-y overflow-y-auto rounded-md border">
              {rows.map((row) => (
                <li key={row.index}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox checked={selected.has(row.index)} onChange={(event) => toggle(row.index, event.target.checked)} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium">{row.name}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {format(plural(row.ingredientCount, dict.importFileIngredients), { count: row.ingredientCount })}
                        {row.exists && <Badge variant="secondary">{dict.importFileExists}</Badge>}
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
              {dict.importFileOtherFile}
            </Button>
            <Button type="button" onClick={importSelected} disabled={importing || selected.size === 0}>
              <PendingLabel
                pending={importing}
                busy={dict.importFileImporting}
                idle={format(plural(selected.size, dict.importFileSubmit), { count: selected.size })}
              />
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
