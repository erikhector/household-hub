"use client";

import { useId, useState, type ReactElement } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ComboField } from "@/components/inventory/combo-field";
import { bulkCreateInventoryItemsAction } from "@/app/dashboard/inventory/actions";
import { parsePastedList } from "@/lib/inventory/parse-pasted-list";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type Row = { key: string; name: string; quantity: number; unit: string };
type Step = "paste" | "review";

/**
 * A "brain dump" bulk-add: paste or type a freeform list, one item per line
 * or comma, and get an editable row per item before anything is saved. See
 * lib/inventory/parse-pasted-list.ts for what it does and doesn't try to
 * pick up automatically (a leading count, a trailing "x8") — anything it
 * misreads is still just a text field to fix here.
 */
export function BulkPasteDialog({
  dict,
  categories,
  locations,
  trigger,
}: {
  dict: Dictionary["inventory"];
  categories: string[];
  locations: string[];
  trigger: ReactElement;
}) {
  const t = dict.pasteList;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("paste");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const idPrefix = useId();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setStep("paste");
      setText("");
      setRows([]);
      setCategory("");
      setLocation("");
    }
  };

  const handleParse = () => {
    const parsed = parsePastedList(text);
    if (parsed.length === 0) {
      toast.error(t.emptyAfterParse);
      return;
    }
    setRows(parsed.map((item, i) => ({ key: `${i}-${item.name}`, ...item })));
    setStep("review");
  };

  const updateRow = (key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  };

  const handleAddAll = async () => {
    if (rows.some((row) => !row.name.trim())) {
      toast.error(t.nameRequiredError);
      return;
    }
    setSubmitting(true);
    const result = await bulkCreateInventoryItemsAction(
      rows.map((row) => ({ name: row.name.trim(), quantity: row.quantity, unit: row.unit })),
      { category: category.trim() || undefined, location: location.trim() || undefined },
    );
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    const added = result.added ?? 0;
    if (added > 0) toast.success(format(plural(added, t.addedToast), { count: added }));
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === "paste" ? t.dialogTitle : t.reviewTitle}</DialogTitle>
        </DialogHeader>

        {step === "paste" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t.description}</p>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.textareaPlaceholder}
              rows={8}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" onClick={handleParse} disabled={!text.trim()}>
                {t.parseButton}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-category`}>{t.sharedCategoryLabel}</Label>
                <ComboField
                  id={`${idPrefix}-category`}
                  name="category"
                  items={categories}
                  value={category}
                  onValueChange={setCategory}
                  placeholder={dict.categoryPlaceholder}
                  maxLength={60}
                  dict={dict}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idPrefix}-location`}>{t.sharedLocationLabel}</Label>
                <ComboField
                  id={`${idPrefix}-location`}
                  name="location"
                  items={locations}
                  value={location}
                  onValueChange={setLocation}
                  placeholder={dict.locationPlaceholder}
                  maxLength={120}
                  dict={dict}
                />
              </div>
            </div>

            <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    maxLength={120}
                    className="flex-1"
                    aria-invalid={!row.name.trim()}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: Number(e.target.value) || 0 })}
                    className="w-16"
                  />
                  <Input
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                    maxLength={20}
                    className="w-16"
                  />
                  <button
                    type="button"
                    aria-label={format(t.removeRowAriaLabel, { name: row.name })}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.key)}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {rows.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.emptyAfterParse}</p>
              )}
            </ul>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setStep("paste")}>
                {t.backToPaste}
              </Button>
              <Button type="button" disabled={submitting || rows.length === 0} onClick={handleAddAll}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  format(plural(rows.length, t.addAllButton), { count: rows.length })
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
