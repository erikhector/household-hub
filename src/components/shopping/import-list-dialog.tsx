"use client";

import { useRef, useState, type ReactElement } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogHandle,
} from "@/components/ui/dialog";
import { importShoppingListItemsAction } from "@/app/dashboard/shopping-list/actions";
import { parsePastedList } from "@/lib/inventory/parse-pasted-list";
import { parseImportCsv, type ImportCsvError } from "@/lib/inventory/parse-import-csv";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Row = { key: string; name: string; quantity: string; unit: string };
type Step = "paste" | "review";
type PasteTab = "text" | "csv";

/**
 * Bulk-add a shopping list from text pasted from another app's own
 * share/export feature (e.g. ICA's "share list" text) or an uploaded CSV —
 * the shopping-list counterpart to inventory's BulkPasteDialog, reusing the
 * same parsers (parsePastedList/parseImportCsv) so both flows pick up the
 * same leading/trailing quantity-and-unit conventions. Simpler than that
 * dialog: a shopping-list item has no category/location to set for the
 * whole batch, so this goes straight from parsing to an editable review
 * list to importShoppingListItemsAction, which auto-links each row to
 * inventory the same way a single ad-hoc add does.
 */
export function ImportListDialog({
  listId,
  dict,
  trigger,
  handle,
}: {
  listId: string;
  dict: Dictionary["shoppingList"]["importList"];
  /** Omit when opening through `handle` (e.g. from a menu item). */
  trigger?: ReactElement;
  handle?: DialogHandle;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("paste");
  const [pasteTab, setPasteTab] = useState<PasteTab>("text");
  const [text, setText] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStep("paste");
      setPasteTab("text");
      setText("");
      setCsvFile(null);
      setRows([]);
    }
  };

  const applyParsedItems = (parsed: { name: string; quantity: number; unit: string }[]) => {
    setRows(
      parsed.map((item, i) => ({
        key: `${i}-${item.name}`,
        ...item,
        quantity: String(item.quantity),
      })),
    );
    setStep("review");
  };

  const handleParse = () => {
    const parsed = parsePastedList(text);
    if (parsed.length === 0) {
      toast.error(dict.emptyAfterParse);
      return;
    }
    applyParsedItems(parsed);
  };

  const csvImportErrorMessage = (code: ImportCsvError) => {
    switch (code) {
      case "missingNameColumn":
        return dict.importCsvMissingNameColumnError;
      case "emptyFile":
        return dict.importCsvEmptyError;
    }
  };

  const handleImportCsv = async () => {
    if (!csvFile) return;
    setImporting(true);
    let text: string;
    try {
      text = await csvFile.text();
    } catch {
      setImporting(false);
      toast.error(dict.importCsvReadError);
      return;
    }
    const result = parseImportCsv(text);
    setImporting(false);
    if (!result.ok) {
      toast.error(csvImportErrorMessage(result.error));
      return;
    }
    applyParsedItems(result.items);
  };

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleImportAll = async () => {
    if (rows.some((row) => !row.name.trim())) {
      toast.error(dict.nameRequiredError);
      return;
    }
    setSubmitting(true);
    const result = await importShoppingListItemsAction(
      listId,
      rows.map((row) => ({ name: row.name.trim(), quantity: Number(row.quantity) || 1, unit: row.unit })),
    );
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const added = result.added ?? 0;
    if (added > 0) toast.success(format(plural(added, dict.addedToast), { count: added }));
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === "paste" ? dict.dialogTitle : dict.reviewTitle}</DialogTitle>
        </DialogHeader>

        {step === "paste" && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={pasteTab === "text" ? "default" : "outline"}
                onClick={() => setPasteTab("text")}
              >
                {dict.pasteTabLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={pasteTab === "csv" ? "default" : "outline"}
                onClick={() => setPasteTab("csv")}
              >
                {dict.uploadTabLabel}
              </Button>
            </div>

            {pasteTab === "text" && (
              <>
                <p className="text-sm text-muted-foreground">{dict.description}</p>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={dict.textareaPlaceholder}
                  rows={8}
                  autoFocus
                />
                <DialogFooter>
                  <Button type="button" onClick={handleParse} disabled={!text.trim()}>
                    {dict.parseButton}
                  </Button>
                </DialogFooter>
              </>
            )}

            {pasteTab === "csv" && (
              <>
                <p className="text-sm text-muted-foreground">{dict.uploadDescription}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    {dict.uploadButtonLabel}
                  </Button>
                  {csvFile && (
                    <span className="truncate text-sm text-muted-foreground">
                      {format(dict.uploadFileSelected, { name: csvFile.name })}
                    </span>
                  )}
                </div>
                <DialogFooter>
                  <Button type="button" onClick={handleImportCsv} disabled={!csvFile || importing}>
                    {importing ? <Loader2 className="size-4 animate-spin" /> : dict.importButton}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    maxLength={120}
                    className="flex-1"
                    aria-invalid={!row.name.trim()}
                    aria-label={dict.nameLabel}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    className="w-16"
                    aria-label={dict.quantityLabel}
                  />
                  <Input
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                    maxLength={20}
                    className="w-16"
                    aria-label={dict.unitLabel}
                  />
                  <button
                    type="button"
                    aria-label={format(dict.removeRowAriaLabel, { name: row.name })}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.key)}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {rows.length === 0 && <p className="text-sm text-muted-foreground">{dict.emptyAfterParse}</p>}
            </ul>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("paste")}>
                {dict.backToPaste}
              </Button>
              <Button type="button" disabled={submitting || rows.length === 0} onClick={handleImportAll}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  format(plural(rows.length, dict.importAllButton), { count: rows.length })
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
